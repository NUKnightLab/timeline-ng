/**
 * The reactive bridge between the Yjs document and Svelte, per
 * docs/coauthoring.md §3.2 and docs/phase1-plan.md Stage 1.
 *
 * The document is the source of truth; this observes it and rebuilds plain
 * `$state` in the shapes the editor already uses. Components keep working
 * against ordinary objects and know nothing about Yjs — which is the point:
 * Phase 2 adds a network provider to the same document and nothing here or
 * above has to change.
 *
 * Rebuilding the whole snapshot on every change is deliberate. It costs a
 * re-derive per keystroke at timeline sizes measured in tens of slides, and it
 * buys an editor that cannot drift from the document.
 */
import * as Y from 'yjs';
import type { TLEvent, TLSettings, TLTimeline } from '@knight-lab/timeline-ng-core';
import {
  addSlide, createDoc, docToTimeline, enclosingFragment, hasTitleSlide, listSlides,
  loadTimeline, locateFragment, readMeta, readSettings, readSlide, removeSlide,
  setMirror, settingsMap, slidesMap, titleMap, writeMeta, writeSlide,
} from './doc.ts';
import type { DocMeta, SlideEntry } from './doc.ts';
import { RICH_TEXT_FIELDS } from './doc.ts';
import type { RichTextField } from './doc.ts';
import { fragmentToHtml, schemaFor } from './richtext.ts';

/**
 * Marks the transactions this class makes to keep HTML mirrors in step with
 * their fragments. Two things depend on being able to recognise them: the
 * mirror pass itself, which must not re-trigger on its own writes, and Stage
 * 6's `UndoManager`, which must not offer derived state as something to undo.
 */
export const MIRROR_ORIGIN = Symbol('mirror');

/** The two rich-text fields, for callers wiring editors to them. */
export const HEADLINE_FIELD = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'headline')!;
export const BODY_FIELD = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'text')!;

export class TimelineDoc {
  readonly doc: Y.Doc = createDoc();

  #entries = $state<SlideEntry[]>([]);
  #titleEvent = $state<TLEvent | null>(null);
  #settings = $state<TLSettings>({});
  #meta = $state<DocMeta>({});

  /**
   * The document's content as of the last save or load, serialized. `null`
   * means "known dirty" — an import, say, which has never been saved anywhere.
   */
  #savedSnapshot = $state<string | null>(null);

  readonly #timeline = $derived<TLTimeline>({
    ...(this.#titleEvent ? { title: this.#titleEvent } : {}),
    events: this.#entries.map((e) => e.event),
    settings: this.#settings,
  });

  /** Fragments whose HTML mirror is out of date. */
  #staleMirrors = new Set<Y.XmlFragment>();
  #mirrorScheduled = false;

  #onUpdate = () => this.#sync();

  #onAfterTransaction = (tr: Y.Transaction) => {
    if (tr.origin === MIRROR_ORIGIN) return;
    for (const type of tr.changed.keys()) {
      const fragment = enclosingFragment(type);
      if (fragment) this.#staleMirrors.add(fragment);
    }
    // Only the fragments that actually changed, which is the point: a whole-
    // document pass would serialize every field on the timeline per keystroke.
    if (this.#staleMirrors.size > 0 && !this.#mirrorScheduled) {
      this.#mirrorScheduled = true;
      queueMicrotask(() => this.flushMirrors());
    }
  };

  constructor() {
    this.doc.on('update', this.#onUpdate);
    this.doc.on('afterTransaction', this.#onAfterTransaction);
    this.#sync();
  }

  destroy(): void {
    this.doc.off('update', this.#onUpdate);
    this.doc.off('afterTransaction', this.#onAfterTransaction);
    this.doc.destroy();
  }

  /**
   * Bring every stale HTML mirror back in step with its fragment.
   *
   * Runs on a microtask after an edit, and synchronously before anything reads
   * the document as a timeline. Deriving here rather than in the editor is what
   * makes the mirror correct under concurrent edits and under undo — see
   * richtext.ts and phase1-plan.md [P10].
   */
  flushMirrors(): void {
    this.#mirrorScheduled = false;
    if (this.#staleMirrors.size === 0) return;
    const stale = [...this.#staleMirrors];
    this.#staleMirrors.clear();
    this.doc.transact(() => {
      for (const fragment of stale) {
        const located = locateFragment(fragment);
        if (!located) continue;   // the slide was deleted out from under it
        setMirror(located.slide, located.field.mirrorField, fragmentToHtml(fragment, schemaFor(located.field.options)));
      }
    }, MIRROR_ORIGIN);
  }

  #sync(): void {
    this.#entries = listSlides(this.doc);
    this.#titleEvent = hasTitleSlide(this.doc) ? readSlide(titleMap(this.doc)) : null;
    this.#settings = readSettings(this.doc);
    this.#meta = readMeta(this.doc);
  }

  // ── Reading ─────────────────────────────────────────────────────────────────

  /** Slides in display order, without the title slide. */
  get events(): TLEvent[] { return this.#timeline.events; }
  get entries(): SlideEntry[] { return this.#entries; }
  get titleEvent(): TLEvent | null { return this.#titleEvent; }
  get settings(): TLSettings { return this.#settings; }
  get timeline(): TLTimeline { return this.#timeline; }

  get title(): string { return this.#meta.title ?? ''; }
  get titleSetByUser(): boolean { return this.#meta.titleSetByUser ?? false; }
  get atUri(): string | null { return this.#meta.atUri ?? null; }

  get isEmpty(): boolean { return this.#entries.length === 0 && !this.#titleEvent; }

  /**
   * Whether the document matches the last save or load.
   *
   * Derived rather than remembered — the editor used to set a `pdsClean` flag by
   * hand at every mutation site, which is the same information computed less
   * reliably. Comparing content rather than Yjs state means undoing back to the
   * saved text reports clean again, which the flag could not do.
   */
  get clean(): boolean {
    return this.#savedSnapshot !== null && JSON.stringify(this.#timeline) === this.#savedSnapshot;
  }

  /**
   * A slide by its internal key, or the title slide.
   *
   * There is deliberately no lookup by `unique_id`. That field is author-facing
   * and editable, and nothing guarantees it is unique — two collaborators can
   * choose the same one at once, and uniqueness is only enforced as a
   * validation pass at publish. Identity is the key.
   */
  eventForKey(key: string | null): TLEvent | null {
    if (key === null) return null;
    if (key === 'title') return this.#titleEvent;
    return this.#entries.find((e) => e.key === key)?.event ?? null;
  }

  // ── Writing ─────────────────────────────────────────────────────────────────

  /** Replace the document. `clean` says whether the result counts as saved. */
  load(timeline: TLTimeline, meta: DocMeta = {}, opts: { clean?: boolean } = {}): void {
    loadTimeline(this.doc, timeline, meta);
    if (opts.clean ?? true) this.markClean();
    else this.#savedSnapshot = null;
  }

  /** Record the current content as the saved one. */
  markClean(): void {
    this.flushMirrors();
    this.#savedSnapshot = JSON.stringify(this.#timeline);
  }

  /** Add a slide, returning the internal key it was stored under. */
  addEvent(event: TLEvent): string {
    return addSlide(this.doc, event);
  }

  setTitleSlide(event: TLEvent): void {
    this.doc.transact(() => writeSlide(titleMap(this.doc), event));
  }

  removeTitleSlide(): void {
    titleMap(this.doc).clear();
  }

  /**
   * Write a whole slide by its internal key.
   *
   * A rename used to need the ID the slide had *before* the update, because the
   * new one matched nothing yet. Keying by an internal id removes the problem
   * rather than handling it: `unique_id` is now an ordinary field that changes
   * like any other.
   */
  updateEvent(key: string, updated: TLEvent): void {
    if (key === 'title') { this.setTitleSlide(updated); return; }
    const slide = slidesMap(this.doc).get(key);
    if (!slide) return;
    this.doc.transact(() => writeSlide(slide, updated));
  }

  removeEvent(key: string): void {
    removeSlide(this.doc, key);
  }

  patchSettings(patch: Partial<TLSettings>): void {
    const map = settingsMap(this.doc);
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) map.delete(k);
        else if (map.get(k) !== v) map.set(k, v);
      }
    });
  }

  setTitle(title: string, setByUser: boolean): void {
    writeMeta(this.doc, { ...this.#meta, title: title || undefined, titleSetByUser: setByUser });
  }

  setAtUri(atUri: string | null): void {
    writeMeta(this.doc, { ...this.#meta, atUri: atUri ?? undefined });
  }

  /** The document as a plain timeline, read straight from Yjs rather than the snapshot. */
  toTimeline(): TLTimeline {
    this.flushMirrors();
    return docToTimeline(this.doc);
  }

  /**
   * The fragment a rich-text editor binds to, addressed the way the editor
   * addresses slides — by `unique_id`, or `'title'`.
   *
   * `null` means this field has no fragment, which is not an error: a field
   * whose prose could not be represented without loss keeps plain HTML instead
   * (see `ensureFragments`). The editor falls back to editing that string, and
   * the only thing given up is merging.
   */
  fragmentFor(key: string | null, field: RichTextField): Y.XmlFragment | null {
    if (key === null) return null;
    const slide = key === 'title' ? titleMap(this.doc) : slidesMap(this.doc).get(key);
    if (!slide || slide.size === 0) return null;
    return slide.get(field.fragmentKey) instanceof Y.XmlFragment
      ? (slide.get(field.fragmentKey) as Y.XmlFragment)
      : null;
  }
}
