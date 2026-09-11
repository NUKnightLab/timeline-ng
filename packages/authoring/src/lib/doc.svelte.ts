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
import { metaMap } from './doc.ts';
import { targetFor } from './historyTarget.ts';
import type { ChangedParentTypes, HistoryTarget } from './historyTarget.ts';
// The key y-prosemirror marks its own transactions with when someone types.
// Matched by identity, so it must be the same module instance Collaboration
// uses — which is why @tiptap/y-tiptap is pinned to the version it resolves.
import { ySyncPluginKey } from '@tiptap/y-tiptap';

/**
 * Marks the transactions this class makes to keep HTML mirrors in step with
 * their fragments. Two things depend on being able to recognise them: the
 * mirror pass itself, which must not re-trigger on its own writes, and Stage
 * 6's `UndoManager`, which must not offer derived state as something to undo.
 */
export const MIRROR_ORIGIN = Symbol('mirror');

/**
 * Origins for everything else that writes to the document.
 *
 * Y.UndoManager tracks transactions whose origin is in its set, and by default
 * that set is `{null}` — so every write made without an origin would become
 * something undo offers back. Loading a timeline would be undoable into an
 * empty document; recording a publish would be undoable into looking unpublished. So
 * every write here names what it is, and only USER_ORIGIN (plus typing, which
 * y-prosemirror marks with ySyncPluginKey) is tracked.
 */
export const USER_ORIGIN = Symbol('user');
const LOAD_ORIGIN = Symbol('load');
/** Facts *about* the document rather than content in it: publishedSnapshot, atUri. */
const BOOKKEEPING_ORIGIN = Symbol('bookkeeping');
/**
 * Values computed from other content, like the timeline title taken from the
 * title slide's headline. Untracked because undoing the source recomputes them,
 * and tracking that recomputation would clear the redo stack after every undo.
 */
const DERIVED_ORIGIN = Symbol('derived');

/** Stack item meta key holding the HistoryTarget recorded when a change was captured. */
const TARGET = 'target';

/** The two rich-text fields, for callers wiring editors to them. */
export const HEADLINE_FIELD = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'headline')!;
export const BODY_FIELD = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'text')!;

export class TimelineDoc {
  readonly doc: Y.Doc = createDoc();

  #entries = $state<SlideEntry[]>([]);
  #titleEvent = $state<TLEvent | null>(null);
  #settings = $state<TLSettings>({});
  #meta = $state<DocMeta>({});

  readonly #timeline = $derived<TLTimeline>({
    ...(this.#titleEvent ? { title: this.#titleEvent } : {}),
    events: this.#entries.map((e) => e.event),
    settings: this.#settings,
  });

  /**
   * One undo stack for the whole timeline — docs/phase1-undo.md D1.
   *
   * Deliberately *not* handed to Tiptap. Collaboration accepts an existing
   * manager through `yUndoOptions`, but its plugin view calls
   * `undoManager.destroy()` whenever an editor unmounts, and headline and body
   * editors unmount every time a field closes or the slide changes. A shared
   * manager would be torn down most of the time. Each editor keeps a throwaway
   * manager of its own and routes Mod-z here instead — see RichTextEditor.
   */
  readonly #history: Y.UndoManager;
  #applyingHistory = false;
  #canUndo = $state(false);
  #canRedo = $state(false);

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

    this.#history = new Y.UndoManager(
      [slidesMap(this.doc), titleMap(this.doc), settingsMap(this.doc), metaMap(this.doc)],
      {
        trackedOrigins: new Set<unknown>([USER_ORIGIN, ySyncPluginKey]),
        // y-prosemirror marks some of its own transactions — the initial render
        // of a fragment, for one — as not belonging in history. The manager it
        // would have created respects that; one supplied from outside does not
        // unless told to.
        captureTransaction: (tr) => tr.meta.get('addToHistory') !== false,
      },
    );

    // Record what each change touched *as it is captured*, because undo must
    // reveal its target before applying it and Yjs only reports what an undo
    // changed afterwards. A merged typing burst keeps its first target.
    const record = ({ stackItem, changedParentTypes }: { stackItem: { meta: Map<unknown, unknown> }; changedParentTypes: unknown }) => {
      if (stackItem.meta.has(TARGET)) return;
      const target = targetFor(this.doc, changedParentTypes as ChangedParentTypes);
      if (target) stackItem.meta.set(TARGET, target);
    };
    this.#history.on('stack-item-added', record);
    this.#history.on('stack-item-updated', record);
    for (const event of ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const) {
      this.#history.on(event, this.#refreshHistory);
    }

    this.#sync();
  }

  destroy(): void {
    this.#history.destroy();
    this.doc.off('update', this.#onUpdate);
    this.doc.off('afterTransaction', this.#onAfterTransaction);
    this.doc.destroy();
  }

  #refreshHistory = () => {
    this.#canUndo = this.#history.undoStack.length > 0;
    this.#canRedo = this.#history.redoStack.length > 0;
  };

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
   * Whether the document matches the last publish or load.
   *
   * Derived rather than remembered — the editor used to set a `pdsClean` flag by
   * hand at every mutation site, which is the same information computed less
   * reliably. Comparing content rather than Yjs state means undoing back to the
   * saved text reports clean again, which the flag could not do.
   */
  get clean(): boolean {
    const saved = this.#meta.publishedSnapshot;
    return typeof saved === 'string' && JSON.stringify(this.#timeline) === saved;
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

  // ── History ─────────────────────────────────────────────────────────────────

  get canUndo(): boolean { return this.#canUndo; }
  get canRedo(): boolean { return this.#canRedo; }
  get undoDepth(): number { return this.#history.undoStack.length; }

  /**
   * True while an undo or redo is being applied.
   *
   * Undoing a change to a rich-text field updates its mounted editor
   * synchronously, which fires the editor's onchange, which re-emits the whole
   * slide from EventEditor's local copies of every *other* field. Those copies
   * are stale until the editor re-reads the document, so honouring that emit
   * would write undone values straight back — and, being a new tracked change,
   * clear the redo stack. Writes that arrive during this window are dropped.
   */
  get applyingHistory(): boolean { return this.#applyingHistory; }

  /** What undo would change next, so the editor can bring it into view first. */
  peekUndo(): HistoryTarget | null { return this.#peek(this.#history.undoStack); }
  peekRedo(): HistoryTarget | null { return this.#peek(this.#history.redoStack); }

  #peek(stack: Y.UndoManager['undoStack']): HistoryTarget | null {
    const item = stack[stack.length - 1];
    return (item?.meta.get(TARGET) as HistoryTarget | undefined) ?? null;
  }

  undo(): boolean { return this.#applyHistory(() => this.#history.undo()); }
  redo(): boolean { return this.#applyHistory(() => this.#history.redo()); }

  #applyHistory(run: () => unknown): boolean {
    this.#applyingHistory = true;
    try {
      return run() !== null;
    } finally {
      this.#applyingHistory = false;
    }
  }

  /** End the current capture, so the next change starts a stack item of its own. */
  captureBoundary(): void {
    this.#history.stopCapturing();
  }

  /** The newest undoable change, as a handle a caller can recognise later. */
  latestUndoItem(): object | null {
    const stack = this.#history.undoStack;
    return stack[stack.length - 1] ?? null;
  }

  isNextUndo(item: object): boolean {
    const stack = this.#history.undoStack;
    return stack[stack.length - 1] === item;
  }

  /** Whether `item` is still undoable — false once it has been undone. */
  hasUndoItem(item: object): boolean {
    // Via a local: a private field cannot appear inside a `typeof` type query.
    const stack = this.#history.undoStack;
    return stack.includes(item as (typeof stack)[number]);
  }

  /**
   * Drop a change from undo history without applying it.
   *
   * For a change that was reverted some other way — the deleted-slide restore
   * row re-adds a slide as a new map, and leaving the deletion on the stack
   * would let Cmd-Z bring the original back as well, giving two copies.
   */
  forgetUndoItem(item: object): void {
    const stack = this.#history.undoStack;
    const at = stack.indexOf(item as (typeof stack)[number]);
    if (at !== -1) stack.splice(at, 1);
    this.#refreshHistory();
  }

  // ── Writing ─────────────────────────────────────────────────────────────────

  /** A user edit: tracked for undo, and ignored while history is being applied. */
  #user(write: () => void): void {
    if (this.#applyingHistory) return;
    this.doc.transact(write, USER_ORIGIN);
  }

  /** Replace the document. `clean` says whether the result counts as saved. */
  load(timeline: TLTimeline, meta: DocMeta = {}, opts: { clean?: boolean } = {}): void {
    this.doc.transact(() => loadTimeline(this.doc, timeline, meta), LOAD_ORIGIN);
    if (opts.clean ?? true) this.markClean();
    this.#history.clear();
  }

  /**
   * Record the current content as the saved one.
   *
   * Kept in the document rather than on this object, so that reopening a draft
   * from storage still knows whether it matches what was published.
   */
  markClean(): void {
    this.flushMirrors();
    this.doc.transact(
      () => writeMeta(this.doc, { ...this.#meta, publishedSnapshot: JSON.stringify(this.#timeline) }),
      BOOKKEEPING_ORIGIN,
    );
  }

  /** Add a slide, returning the internal key it was stored under. */
  addEvent(event: TLEvent): string {
    let key = '';
    this.doc.transact(() => { key = addSlide(this.doc, event); }, USER_ORIGIN);
    return key;
  }

  setTitleSlide(event: TLEvent): void {
    this.#user(() => writeSlide(titleMap(this.doc), event));
  }

  removeTitleSlide(): void {
    this.doc.transact(() => titleMap(this.doc).clear(), USER_ORIGIN);
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
    this.#user(() => writeSlide(slide, updated));
  }

  removeEvent(key: string): void {
    this.doc.transact(() => removeSlide(this.doc, key), USER_ORIGIN);
  }

  patchSettings(patch: Partial<TLSettings>): void {
    const map = settingsMap(this.doc);
    this.#user(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) map.delete(k);
        else if (map.get(k) !== v) map.set(k, v);
      }
    });
  }

  /**
   * Set the timeline title.
   *
   * `derived` marks a title computed from the title slide's headline rather
   * than typed by the author. Those writes are untracked: undoing the headline
   * recomputes the title, and tracking that would clear the redo stack.
   */
  setTitle(title: string, setByUser: boolean, opts: { derived?: boolean } = {}): void {
    const write = () => writeMeta(this.doc, { ...this.#meta, title: title || undefined, titleSetByUser: setByUser });
    if (opts.derived) this.doc.transact(write, DERIVED_ORIGIN);
    else this.#user(write);
  }

  setAtUri(atUri: string | null): void {
    this.doc.transact(() => writeMeta(this.doc, { ...this.#meta, atUri: atUri ?? undefined }), BOOKKEEPING_ORIGIN);
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
