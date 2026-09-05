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
import { RICH_TEXT_FIELDS, slideFragment } from './doc.ts';
import { fragmentToHtml, schemaFor } from './richtext.ts';

/**
 * Marks the transactions this class makes to keep HTML mirrors in step with
 * their fragments. Two things depend on being able to recognise them: the
 * mirror pass itself, which must not re-trigger on its own writes, and Stage
 * 6's `UndoManager`, which must not offer derived state as something to undo.
 */
export const MIRROR_ORIGIN = Symbol('mirror');

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

  /** The internal key a slide is stored under, found by its author-facing ID. */
  keyForUniqueId(uniqueId: string): string | undefined {
    return this.#entries.find((e) => e.event.unique_id === uniqueId)?.key;
  }

  eventForUniqueId(uniqueId: string): TLEvent | null {
    return this.#entries.find((e) => e.event.unique_id === uniqueId)?.event ?? null;
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

  addEvent(event: TLEvent): void {
    addSlide(this.doc, event);
  }

  setTitleSlide(event: TLEvent): void {
    this.doc.transact(() => writeSlide(titleMap(this.doc), event));
  }

  removeTitleSlide(): void {
    titleMap(this.doc).clear();
  }

  /**
   * Write a whole slide, found by the ID it had *before* this update — a rename
   * arrives with the new ID already in `updated`, which would match nothing.
   *
   * Stage 2 replaces the body of this with a field-level diff so that a
   * one-character headline edit stops rewriting the entire slide.
   */
  updateEvent(previousUniqueId: string, updated: TLEvent): void {
    const key = this.keyForUniqueId(previousUniqueId);
    const slide = key === undefined ? undefined : slidesMap(this.doc).get(key);
    if (!slide) return;
    this.doc.transact(() => writeSlide(slide, updated));
  }

  removeEvent(uniqueId: string): void {
    const key = this.keyForUniqueId(uniqueId);
    if (key !== undefined) removeSlide(this.doc, key);
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

  /** The `Y.XmlFragment` a rich-text editor binds to, by slide key and field. */
  fragmentFor(slideKey: string | 'title', mirrorField: 'headline' | 'text'): Y.XmlFragment | null {
    const slide = slideKey === 'title' ? titleMap(this.doc) : slidesMap(this.doc).get(slideKey);
    if (!slide) return null;
    const field = RICH_TEXT_FIELDS.find((f) => f.mirrorField === mirrorField);
    return field ? slideFragment(slide, field) : null;
  }
}
