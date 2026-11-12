/**
 * Where drafts live in the browser, per docs/phase1-plan.md Stage 5.
 *
 * Before this, the editor kept one draft in a single localStorage key, so
 * opening a second timeline discarded the first without saying so. A Yjs
 * document is persisted per document by nature, which makes several drafts the
 * default shape rather than a feature — what has to be built is the *index*
 * that lists them, because IndexedDB cannot be asked "what have I got" in a way
 * every browser agrees on (`indexedDB.databases()` is still not universal).
 *
 * So: the documents live in IndexedDB, one database each, and a small index in
 * localStorage records enough to draw a list — a title, when it was touched,
 * whether it has ever been published. The index is derived data. If it is lost
 * the documents survive; if it disagrees with reality, `reconcile` fixes it.
 */
import type * as Y from 'yjs';
import type { IndexeddbPersistence } from 'y-indexeddb';
import type { TLTimeline } from '@knight-lab/timeline-ng-core';
import { docToTimeline } from './doc.ts';

/** localStorage key holding the index of stored drafts. */
const INDEX_KEY = 'tl-drafts-v1';

/** The single-draft key this replaces. Read once, at migration, then removed. */
export const LEGACY_DRAFT_KEY = 'tl-draft-v1';

/** IndexedDB database name for a draft's Yjs document. */
export const dbNameFor = (id: string): string => `tl-doc-${id}`;

export interface DraftSummary {
  id: string;
  /** The timeline's title, for the list. Empty is normal — untitled drafts exist. */
  title: string;
  /** ISO timestamp of the last edit. */
  editedAt: string;
  /** Set once published; the record on the PDS this draft would overwrite. */
  atUri?: string;
  /**
   * Whether this draft matches what is published — the document's own `clean`
   * flag, not a guess from timestamps.
   *
   * Comparing `editedAt` against the record's publish time cannot answer this:
   * publishing writes the new `atUri` and marks the document clean, and both
   * of those are edits to the document, so a just-published draft always looks
   * newer than the record it just produced.
   *
   * Absent on entries written before this was recorded, and on drafts that
   * have never been published, where there is nothing to be clean against.
   */
  clean?: boolean;
  /**
   * The CID of the record this draft was last in step with.
   *
   * Kept here as well as in the document so the list can say *"a newer
   * version was published elsewhere"* without opening every draft to find
   * out: `listRecords` returns each record's CID, and comparing the two is
   * the whole test ([P5], [P8] in `docs/phase1-sync-conflicts.md`).
   *
   * Absent on a draft that has never been published, and on entries written
   * before this was recorded — in which case the row simply says less.
   */
  baseCid?: string;
  /**
   * The handle of the account this draft publishes to, recorded when it
   * gains a record.
   *
   * For display only — ownership itself is read from the `atUri`, which
   * carries the DID. A DID is not a thing anyone recognises, and the row has
   * to be able to say *whose* timeline it is without a network lookup for
   * every row at every paint.
   *
   * Handles are reassignable, so this can go stale; a stale handle on a row
   * that is already marked as another account's is a small enough wrong to
   * be worth the alternative, which is resolving DIDs on the home screen.
   */
  ownerHandle?: string;
  /**
   * Set on a fork — the draft *Keep both* leaves behind ([P10], [P11] in
   * `docs/phase1-sync-conflicts.md`).
   *
   * A fork holds no `atUri`, deliberately: two drafts claiming one record is
   * the bug `536221b` fixed, and `listDrafts().find(d => d.atUri === uri)`
   * would choose between them arbitrarily. But an `atUri`-less draft publishes
   * as a *new* record, which would quietly create a second public timeline
   * while existing share links still point at the first. So a fork is a third
   * kind of thing: it remembers where it came from without claiming it, and is
   * publish-blocked until someone says which they meant.
   *
   * It carries the base it diverged from, not just its content. With the
   * ancestor kept, reconciliation a week later is still the same three-way
   * analysis as the moment it forked, rather than a two-way diff that cannot
   * tell the author's own work from anyone else's.
   */
  forkedFrom?: {
    atUri: string;
    baseCid: string;
    /** The published version both sides diverged from, serialized. */
    baseSnapshot: string;
  };
}

function readIndex(): DraftSummary[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is DraftSummary =>
      !!d && typeof d === 'object' && typeof (d as DraftSummary).id === 'string');
  } catch {
    return [];
  }
}

function writeIndex(drafts: DraftSummary[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(drafts));
  } catch { /* storage full or blocked; the documents themselves are unaffected */ }
}

/** Drafts most recently edited first. */
export function listDrafts(): DraftSummary[] {
  return readIndex().sort((a, b) => (a.editedAt < b.editedAt ? 1 : -1));
}

export function newDocId(): string {
  return crypto.randomUUID();
}

/** Record or update a draft's entry. Called as the document changes. */
export function noteDraft(summary: Omit<DraftSummary, 'editedAt'> & { editedAt?: string }): void {
  const editedAt = summary.editedAt ?? new Date().toISOString();
  const existing = readIndex().find((d) => d.id === summary.id);
  const rest = readIndex().filter((d) => d.id !== summary.id);
  const entry: DraftSummary = { id: summary.id, title: summary.title, editedAt };
  if (summary.atUri) entry.atUri = summary.atUri;
  if (summary.clean !== undefined) entry.clean = summary.clean;
  // Like provenance below: a caller that does not know about the base CID
  // must not strip it, or the list quietly loses the one thing that lets it
  // notice another browser got there first.
  const baseCid = summary.baseCid ?? existing?.baseCid;
  if (baseCid) entry.baseCid = baseCid;
  const ownerHandle = summary.ownerHandle ?? existing?.ownerHandle;
  if (ownerHandle) entry.ownerHandle = ownerHandle;
  // Provenance survives a caller that does not know about it. Most writers of
  // this index are routine — going home, autosaving a title — and rebuilding
  // the entry from scratch each time would quietly strip a fork's ancestor,
  // which is the one thing that makes its reconciliation cheap.
  const forkedFrom = summary.forkedFrom ?? existing?.forkedFrom;
  if (forkedFrom) entry.forkedFrom = forkedFrom;
  writeIndex([entry, ...rest]);
}

/** The document itself, with no opinion about the index. */
async function dropDatabase(id: string): Promise<void> {
  await new Promise<void>((resolve) => {
    // Resolve either way. A blocked delete — another tab still has the
    // database open — must not leave the caller hanging; the entry is already
    // gone from the index, so the draft has disappeared from the user's view.
    const request = indexedDB.deleteDatabase(dbNameFor(id));
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

/** Drop a draft: its index entry and the database holding its document. */
export async function forgetDraft(id: string): Promise<void> {
  writeIndex(readIndex().filter((d) => d.id !== id));
  await dropDatabase(id);
}

/**
 * Documents whose index entries are gone but whose databases are not yet
 * dropped — the window in which a deletion can still be undone.
 *
 * Kept in localStorage rather than in memory because the window can outlive
 * the page: close the tab in the middle of it and the entries are already
 * gone, so nothing would ever come back for the databases. The sweep below
 * finishes the job at the next start, which is what makes "delete now, offer
 * undo" safe to prefer over "defer the deletion and hope the tab stays open".
 * Deferring has the worse failure: the author asks for something and it
 * silently never happens.
 */
const PENDING_KEY = 'tl-drafts-pending-delete-v1';

function readPending(): string[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writePending(ids: string[]): void {
  try {
    if (ids.length) localStorage.setItem(PENDING_KEY, JSON.stringify(ids));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage full or blocked; the sweep is best-effort by nature */ }
}

/** The unmerged drafts that cannot outlive `going` — see `forgetDraftWithForks`. */
function forksOf(index: DraftSummary[], going: DraftSummary): DraftSummary[] {
  // Only a draft that owns a record can have an unmerged draft of it, and an
  // unmerged draft never owns one.
  if (!going.atUri || going.forkedFrom) return [];
  return index.filter((d) => d.forkedFrom?.atUri === going.atUri);
}

/**
 * Take a draft and its unmerged drafts out of the list, leaving their
 * documents where they are.
 *
 * The first half of a deletion. The row goes at once — the index *is* the
 * list — while the documents stay recoverable until `commitDraftDeletions`
 * runs. That gap is what an undo card is offering.
 *
 * Returns what was removed, which is also what puts it back.
 */
export function removeDraftEntries(id: string): DraftSummary[] {
  const index = readIndex();
  const going = index.find((d) => d.id === id);
  if (!going) return [];
  const removed = [going, ...forksOf(index, going)];
  const ids = new Set(removed.map((d) => d.id));
  writeIndex(index.filter((d) => !ids.has(d.id)));
  writePending([...new Set([...readPending(), ...ids])]);
  return removed;
}

/** Put back exactly what `removeDraftEntries` took. */
export function restoreDraftEntries(entries: DraftSummary[]): void {
  if (!entries.length) return;
  const index = readIndex();
  const ids = new Set(entries.map((d) => d.id));
  writeIndex([...entries, ...index.filter((d) => !ids.has(d.id))]);
  writePending(readPending().filter((id) => !ids.has(id)));
}

/** The second half: drop the documents, once undo is no longer on offer. */
export async function commitDraftDeletions(entries: DraftSummary[]): Promise<void> {
  const ids = new Set(entries.map((d) => d.id));
  for (const entry of entries) await dropDatabase(entry.id);
  writePending(readPending().filter((id) => !ids.has(id)));
}

/**
 * Finish deletions the page did not outlive. Run at start.
 *
 * A database listed as pending with no index entry is storage held by a draft
 * the author already deleted: nothing can reach it, and nothing will.
 */
export async function sweepPendingDeletions(): Promise<void> {
  const pending = readPending();
  if (!pending.length) return;
  const live = new Set(readIndex().map((d) => d.id));
  for (const id of pending) {
    // Undo ran after all, and the entry is back in the index.
    if (live.has(id)) continue;
    await dropDatabase(id);
  }
  writePending([]);
}

/**
 * Delete a draft and any unmerged draft of it.
 *
 * A storage-level invariant rather than a screen's behaviour: an unmerged
 * draft is only meaningful next to the timeline it came from — sorting it out
 * needs that timeline open as the working document — so it cannot outlive it.
 * Left behind, it became a row that warned about a timeline "above" which no
 * longer existed and could never be merged into anything.
 *
 * Returns how many unmerged drafts went with it, so the caller can say so
 * before the click rather than after.
 */
export async function forgetDraftWithForks(id: string): Promise<number> {
  const removed = removeDraftEntries(id);
  await commitDraftDeletions(removed);
  return Math.max(removed.length - 1, 0);
}

export interface PersistResult {
  /** `null` when local persistence is unavailable — see below. */
  provider: IndexeddbPersistence | null;
  /** Why persistence is unavailable, for the warning shown to the author. */
  error: string | null;
}

/**
 * Attach IndexedDB persistence to a document, resolving once the stored state
 * has been applied — so callers can tell an empty draft from an unloaded one.
 *
 * **Never throws.** IndexedDB is not always there: Safari and Firefox have both
 * withheld or emptied it in private windows, storage can be blocked by
 * policy, and a quota can be exhausted. None of that should cost someone their
 * editor — it should cost them local persistence, loudly. The caller degrades
 * to an unsaved session and says so rather than failing to start.
 *
 * This is also the one part of the store that cannot be tested honestly:
 * `fake-indexeddb` implements the specification, not the ways real browsers
 * depart from it.
 */
export async function persistDoc(id: string, doc: Y.Doc): Promise<PersistResult> {
  if (typeof indexedDB === 'undefined') {
    return { provider: null, error: 'This browser is not storing data for this site.' };
  }
  try {
    const { IndexeddbPersistence } = await import('y-indexeddb');
    const provider = new IndexeddbPersistence(dbNameFor(id), doc);
    await provider.whenSynced;
    return { provider, error: null };
  } catch (cause) {
    return { provider: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * The content of a stored draft, read without opening it.
 *
 * The pull-list needs a fork's timeline while the *working* document is the
 * one that is open, and the two live in separate IndexedDB databases. So this
 * attaches a second provider, reads, and detaches again.
 *
 * Detaching is the part that matters. A provider left attached to a per-draft
 * database is a leak that nobody would notice until a browser had a dozen
 * drafts in it, and the document is never handed out — only the plain timeline
 * read off it — so there is nothing left pointing at either one afterwards.
 *
 * The document is a bare `Y.Doc` rather than `createDoc()` on purpose:
 * `createDoc` stamps a schema version, and stamping one onto a document we
 * only mean to read would write to the draft being inspected.
 *
 * Returns null when there is no store, or when the draft holds nothing.
 */
export async function readDraftTimeline(id: string): Promise<TLTimeline | null> {
  if (typeof indexedDB === 'undefined') return null;
  let provider: IndexeddbPersistence | null = null;
  let doc: Y.Doc | null = null;
  try {
    const [{ Doc }, { IndexeddbPersistence }] = await Promise.all([import('yjs'), import('y-indexeddb')]);
    doc = new Doc();
    provider = new IndexeddbPersistence(dbNameFor(id), doc);
    await provider.whenSynced;
    const timeline = docToTimeline(doc);
    return timeline.events.length || timeline.title ? timeline : null;
  } catch {
    return null;
  } finally {
    await provider?.destroy();
    doc?.destroy();
  }
}
