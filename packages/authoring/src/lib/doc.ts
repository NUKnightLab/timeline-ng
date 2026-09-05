/**
 * The Yjs document model for a timeline, per docs/coauthoring.md §3.2.
 *
 * This module is deliberately free of Svelte and of any UI concern: it is the
 * translation between a `TLTimeline` and a `Y.Doc`, and nothing else. The
 * reactive bridge lives in `doc.svelte.ts`.
 *
 *   Y.Doc
 *   ├─ meta      Y.Map    title, titleSetByUser, atUri
 *   ├─ settings  Y.Map    TLSettings fields
 *   ├─ title     Y.Map    the title slide's fields; empty when there is none
 *   └─ slides    Y.Map    internal key -> slide Y.Map
 *
 * **Slides are keyed by an internal id, never by `unique_id`.** Slide IDs are
 * author-facing — they appear in URLs and are meant to stay legible — so they
 * have to stay editable, and renaming a `Y.Map` key is a delete plus an insert,
 * which under concurrency discards another author's edits to that slide.
 * `unique_id` is therefore an ordinary field that merges like any other.
 *
 * **There is no stored order.** TimelineJS orders slides by date, so ordering is
 * derived on read and never has to converge.
 */
import * as Y from 'yjs';
import { SCHEMA_VERSION, htmlToFragment, schemaFor, seedingLosesContent } from './richtext.ts';
import { compareDates, parseTLDate } from '@knight-lab/timeline-ng-core';
import type {
  ATProtoBlobRef, TLBackground, TLDateInput, TLEvent, TLMedia, TLSettings, TLText, TLTimeline,
} from '@knight-lab/timeline-ng-core';

/** Root-level Y types. Named here so no caller has to remember the strings. */
const META = 'meta';
const SETTINGS = 'settings';
const TITLE = 'title';
const SLIDES = 'slides';

/**
 * Slide fields that are objects, and are stored as nested `Y.Map`s so their
 * sub-fields merge independently — two people editing a caption and a credit
 * on the same slide should not collide.
 */
const GROUP_FIELDS = ['start_date', 'end_date', 'text', 'media', 'background'] as const;

/**
 * Prose lives twice: as a `Y.XmlFragment` that merges, and as an HTML string in
 * the `text` group that does not.
 *
 * The fragment is the source of truth — it is what Tiptap edits and what two
 * authors' edits merge into. The string is a derived mirror, kept because the
 * published record carries HTML (§3.1) and because a Phase 3 server must be
 * able to materialize a record without knowing the ProseMirror schema (§10.6).
 * It is also what `readSlide` reads, so that rebuilding the editor's snapshot
 * costs a string lookup rather than an HTML serialization per field.
 *
 * Keeping the mirror true to the fragment is the bridge's job, not this
 * module's: see `doc.svelte.ts`. Nothing outside that should ever write these
 * strings directly.
 */
export const RICH_TEXT_FIELDS = [
  { fragmentKey: 'headlineXml', mirrorField: 'headline', options: { inlineOnly: true, singleLine: true } },
  { fragmentKey: 'bodyXml', mirrorField: 'text', options: {} },
] as const;

export type RichTextField = (typeof RICH_TEXT_FIELDS)[number];
type GroupField = (typeof GROUP_FIELDS)[number];

/** Slide fields that are plain scalars. */
const SCALAR_FIELDS = ['unique_id', 'media_position', 'group'] as const;

/**
 * Sub-fields stored as opaque JSON rather than decomposed. A `blobRef` is a
 * content-addressed reference — its parts are meaningless apart, and it is only
 * ever replaced wholesale.
 */
const OPAQUE_SUBFIELDS = new Set(['blobRef']);

export interface DocMeta {
  title?: string;
  titleSetByUser?: boolean;
  atUri?: string;
}

/** A slide together with the internal key it is stored under. */
export interface SlideEntry {
  key: string;
  event: TLEvent;
}

export function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  // Stamped from the start. Nothing reads it yet, but retrofitting a version
  // onto documents that lack one is the painful part of any migration, and
  // Phase 2's connect handshake wants the same value. See phase1-plan.md [P9].
  metaMap(doc).set('schemaVersion', SCHEMA_VERSION);
  return doc;
}

/**
 * A fresh internal key. Never shown to anyone and never derived from content,
 * so it can be short — this is a per-document namespace, not a global one.
 */
export function newSlideKey(): string {
  return 's' + Math.random().toString(36).slice(2, 10);
}

export const slidesMap = (doc: Y.Doc): Y.Map<Y.Map<unknown>> => doc.getMap(SLIDES);
export const titleMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(TITLE);
export const settingsMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(SETTINGS);
export const metaMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap(META);

/** A title slide exists iff its map has anything in it. */
export const hasTitleSlide = (doc: Y.Doc): boolean => titleMap(doc).size > 0;

// ── Writing ───────────────────────────────────────────────────────────────────

/**
 * Whether writing `next` over `current` would change anything.
 *
 * Structural rather than referential because `EventEditor` rebuilds the whole
 * `TLEvent` on every keystroke, so object-valued fields — `blobRef` — arrive as
 * a fresh object each time and would otherwise be rewritten on every character
 * typed anywhere on the slide. The values here are small and JSON-shaped;
 * this is not a general deep-equal.
 */
function sameValue(current: unknown, next: unknown): boolean {
  if (current === next) return true;
  if (typeof current !== 'object' || typeof next !== 'object') return false;
  if (current === null || next === null) return false;
  if (Array.isArray(current) !== Array.isArray(next)) return false;
  const a = current as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]));
}

/**
 * Set when defined, delete when not. A key is never present holding `undefined`.
 *
 * Writing a value a key already holds is skipped, and that is load-bearing
 * rather than an optimisation: `Y.Map.set` produces an update even when the
 * value is identical, so an effect that both reads the document and writes a
 * derived value back into it would loop forever.
 */
function put(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    if (map.has(key)) map.delete(key);
  } else if (!sameValue(map.get(key), value)) {
    map.set(key, value);
  }
}

/**
 * Write one object-valued field as a nested map, or remove it. An object with
 * no usable keys is treated as absent: the editor never emits `text: {}`, and
 * round-tripping one into existence would be a difference with no meaning.
 */
function writeGroup(
  slide: Y.Map<unknown>,
  name: string,
  value: Record<string, unknown> | undefined,
  skip: ReadonlySet<string> = new Set(),
): void {
  const entries = value
    ? Object.entries(value).filter(([k, v]) => v !== undefined && v !== null && !skip.has(k))
    : [];
  if (entries.length === 0 && skip.size === 0) {
    slide.delete(name);
    return;
  }
  if (entries.length === 0 && !(slide.get(name) instanceof Y.Map)) return;
  let nested = slide.get(name) as Y.Map<unknown> | undefined;
  if (!(nested instanceof Y.Map)) {
    nested = new Y.Map<unknown>();
    slide.set(name, nested);
  }
  const keep = new Set([...entries.map(([k]) => k), ...skip]);
  for (const existing of [...nested.keys()]) {
    if (!keep.has(existing)) nested.delete(existing);
  }
  for (const [k, v] of entries) {
    // Opaque sub-fields are stored whole; everything else here is already scalar.
    // Same no-op guard as `put`, for the same reason.
    if (!sameValue(nested.get(k), v)) nested.set(k, v);
  }
}

/** Replace a slide map's contents with `event`. Used for load and for whole-slide writes. */
/**
 * Give a slide its rich-text fragments, seeded from whatever HTML it arrived
 * with. Idempotent: a slide that already has them is left alone, so this is
 * safe to call on every load.
 */
export function ensureFragments(slide: Y.Map<unknown>): void {
  const text = slide.get('text') as Y.Map<unknown> | undefined;
  for (const { fragmentKey, mirrorField, options } of RICH_TEXT_FIELDS) {
    if (slide.get(fragmentKey) instanceof Y.XmlFragment) continue;
    const html = text?.get(mirrorField);
    const wanted = typeof html === 'string' ? html : '';

    const fragment = new Y.XmlFragment();
    slide.set(fragmentKey, fragment);
    let seeded = true;
    try {
      if (wanted !== '') htmlToFragment(wanted, schemaFor(options), fragment);
    } catch {
      seeded = false;
    }

    // Refuse to keep a fragment that would lose the prose it was seeded from.
    // Yjs does not roll a transaction back when a callback throws — measured —
    // so without this a single unparseable slide could leave a half-built
    // document behind. Dropping the fragment instead degrades that field to the
    // pre-Stage-3 behaviour: the HTML stays where it is, `writeSlide` owns it
    // again, and the text is still on screen and still publishable.
    //
    // `seedingLosesContent` is the interesting half. ProseMirror is
    // allowlist-only, so an `<img>` or an `<iframe>` in body prose has no node
    // to become and vanishes without leaving any text behind. Rather than
    // publish a paragraph with the photograph quietly removed, that field keeps
    // its HTML and gives up being mergeable.
    if (!seeded || (wanted !== '' && fragment.length === 0)
        || (wanted !== '' && seedingLosesContent(wanted, schemaFor(options), fragment))) {
      slide.delete(fragmentKey);
    }
  }
}

/**
 * Write a rich-text field's derived HTML into the slide's `text` group.
 *
 * Only the bridge should call this — the mirror is derived state, and anything
 * else writing it would be inventing a second source of truth for prose.
 */
export function setMirror(slide: Y.Map<unknown>, mirrorField: string, html: string): void {
  let text = slide.get('text');
  if (!(text instanceof Y.Map)) {
    text = new Y.Map<unknown>();
    slide.set('text', text);
  }
  const map = text as Y.Map<unknown>;
  if (html === '') {
    if (map.has(mirrorField)) map.delete(mirrorField);
  } else if (map.get(mirrorField) !== html) {
    map.set(mirrorField, html);
  }
}

/**
 * The slide map a fragment belongs to, and which field it is, or `null` if this
 * fragment is not one of ours. Identity comparison rather than internal Yjs
 * APIs, so it stays correct if Yjs changes how parents are recorded.
 */
export function locateFragment(fragment: Y.XmlFragment): { slide: Y.Map<unknown>; field: RichTextField } | null {
  const parent = fragment.parent;
  if (!(parent instanceof Y.Map)) return null;
  for (const field of RICH_TEXT_FIELDS) {
    if (parent.get(field.fragmentKey) === fragment) return { slide: parent as Y.Map<unknown>, field };
  }
  return null;
}

/**
 * The outermost plain fragment containing `type`, if any.
 *
 * Walks all the way to the root rather than stopping at the first match,
 * because `Y.XmlElement` extends `Y.XmlFragment` — a paragraph inside a
 * fragment would otherwise answer for the fragment itself.
 */
export function enclosingFragment(type: unknown): Y.XmlFragment | null {
  let found: Y.XmlFragment | null = null;
  let current = type;
  while (current instanceof Y.AbstractType) {
    if (current instanceof Y.XmlFragment && !(current instanceof Y.XmlElement)) found = current;
    current = current.parent;
  }
  return found;
}

/** A slide's fragment for one rich-text field, creating it if it is missing. */
export function slideFragment(slide: Y.Map<unknown>, field: RichTextField): Y.XmlFragment {
  if (!(slide.get(field.fragmentKey) instanceof Y.XmlFragment)) ensureFragments(slide);
  return slide.get(field.fragmentKey) as Y.XmlFragment;
}

/**
 * The rich-text fields a slide's fragments own, and which `writeSlide` must
 * therefore leave alone. Empty until the fragments exist, which is what lets
 * `loadTimeline` seed them from incoming HTML before they are created.
 */
function fragmentOwnedFields(slide: Y.Map<unknown>): Set<string> {
  const owned = new Set<string>();
  for (const f of RICH_TEXT_FIELDS) {
    if (slide.get(f.fragmentKey) instanceof Y.XmlFragment) owned.add(f.mirrorField);
  }
  return owned;
}

/**
 * Replace a slide's fields from a plain event.
 *
 * Rich text is the exception. Once a slide has fragments, `text.headline` and
 * `text.text` are derived from them and owned by the bridge, so an incoming
 * event's copy of that HTML is ignored rather than written — `EventEditor`
 * re-emits the whole event on every keystroke, and honouring its stale prose
 * would overwrite what a collaborator just typed. Before the fragments exist
 * the HTML *is* the content, which is how `loadTimeline` seeds them.
 */
export function writeSlide(slide: Y.Map<unknown>, event: TLEvent): void {
  const owned = fragmentOwnedFields(slide);
  for (const field of SCALAR_FIELDS) put(slide, field, event[field]);
  for (const field of GROUP_FIELDS) {
    writeGroup(
      slide,
      field,
      event[field] as Record<string, unknown> | undefined,
      field === 'text' ? owned : undefined,
    );
  }
}

/** Add a slide and return the internal key it was stored under. */
export function addSlide(doc: Y.Doc, event: TLEvent, key = newSlideKey()): string {
  const slide = new Y.Map<unknown>();
  slidesMap(doc).set(key, slide);
  doc.transact(() => {
    writeSlide(slide, event);
    ensureFragments(slide);
  });
  return key;
}

export function removeSlide(doc: Y.Doc, key: string): void {
  slidesMap(doc).delete(key);
}

export function writeSettings(doc: Y.Doc, settings: TLSettings | undefined): void {
  const map = settingsMap(doc);
  const entries = Object.entries(settings ?? {}).filter(([, v]) => v !== undefined);
  const keep = new Set(entries.map(([k]) => k));
  for (const existing of [...map.keys()]) if (!keep.has(existing)) map.delete(existing);
  for (const [k, v] of entries) if (!sameValue(map.get(k), v)) map.set(k, v);
}

export function writeMeta(doc: Y.Doc, meta: DocMeta): void {
  const map = metaMap(doc);
  put(map, 'title', meta.title);
  put(map, 'titleSetByUser', meta.titleSetByUser);
  put(map, 'atUri', meta.atUri);
}

/**
 * Replace the whole document from a timeline. One transaction, so observers see
 * a single change rather than a storm of them.
 */
export function loadTimeline(doc: Y.Doc, timeline: TLTimeline, meta: DocMeta = {}): void {
  doc.transact(() => {
    slidesMap(doc).clear();
    titleMap(doc).clear();
    if (timeline.title) {
      writeSlide(titleMap(doc), timeline.title);
      ensureFragments(titleMap(doc));
    }
    for (const event of timeline.events) addSlide(doc, event);
    writeSettings(doc, timeline.settings);
    writeMeta(doc, meta);
  });
}

// ── Reading ───────────────────────────────────────────────────────────────────

function readGroup<T>(slide: Y.Map<unknown>, name: string): T | undefined {
  const nested = slide.get(name);
  if (!(nested instanceof Y.Map) || nested.size === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of nested.entries()) out[k] = v;
  return out as T;
}

export function readSlide(slide: Y.Map<unknown>): TLEvent {
  const event: TLEvent = {};
  for (const field of SCALAR_FIELDS) {
    const v = slide.get(field);
    if (v !== undefined) (event as Record<string, unknown>)[field] = v;
  }
  const start = readGroup<TLDateInput>(slide, 'start_date');
  const end = readGroup<TLDateInput>(slide, 'end_date');
  const text = readGroup<TLText>(slide, 'text');
  const media = readGroup<TLMedia>(slide, 'media');
  const background = readGroup<TLBackground>(slide, 'background');
  if (start) event.start_date = start;
  if (end) event.end_date = end;
  if (text) event.text = text;
  if (media) event.media = media;
  if (background) event.background = background;
  return event;
}

/**
 * The comparator the editor has always used: undated slides sink to the bottom,
 * everything else goes in date order. The tiebreak on internal key is new and
 * exists only so that reads are deterministic — `Y.Map` iteration order is not
 * a promise, and without it two slides sharing a date could swap between loads.
 */
function compareEntries(a: SlideEntry, b: SlideEntry): number {
  if (!a.event.start_date) return b.event.start_date ? 1 : (a.key < b.key ? -1 : 1);
  if (!b.event.start_date) return -1;
  const byDate = compareDates(parseTLDate(a.event.start_date), parseTLDate(b.event.start_date));
  return byDate !== 0 ? byDate : (a.key < b.key ? -1 : 1);
}

/** Every slide with its internal key, in display order. */
export function listSlides(doc: Y.Doc): SlideEntry[] {
  const entries: SlideEntry[] = [];
  for (const [key, slide] of slidesMap(doc).entries()) {
    entries.push({ key, event: readSlide(slide) });
  }
  return entries.sort(compareEntries);
}

export function readSettings(doc: Y.Doc): TLSettings {
  const out: Record<string, unknown> = {};
  for (const [k, v] of settingsMap(doc).entries()) out[k] = v;
  return out as TLSettings;
}

export function readMeta(doc: Y.Doc): DocMeta {
  const map = metaMap(doc);
  const out: DocMeta = {};
  const title = map.get('title');
  const titleSetByUser = map.get('titleSetByUser');
  const atUri = map.get('atUri');
  if (typeof title === 'string') out.title = title;
  if (typeof titleSetByUser === 'boolean') out.titleSetByUser = titleSetByUser;
  if (typeof atUri === 'string') out.atUri = atUri;
  return out;
}

export function docToTimeline(doc: Y.Doc): TLTimeline {
  const timeline: TLTimeline = {
    events: listSlides(doc).map((e) => e.event),
    settings: readSettings(doc),
  };
  if (hasTitleSlide(doc)) timeline.title = readSlide(titleMap(doc));
  return timeline;
}

export type { ATProtoBlobRef };
export { OPAQUE_SUBFIELDS };
