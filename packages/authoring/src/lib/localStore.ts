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
  // Provenance survives a caller that does not know about it. Most writers of
  // this index are routine — going home, autosaving a title — and rebuilding
  // the entry from scratch each time would quietly strip a fork's ancestor,
  // which is the one thing that makes its reconciliation cheap.
  const forkedFrom = summary.forkedFrom ?? existing?.forkedFrom;
  if (forkedFrom) entry.forkedFrom = forkedFrom;
  writeIndex([entry, ...rest]);
}

/** Drop a draft: its index entry and the database holding its document. */
export async function forgetDraft(id: string): Promise<void> {
  writeIndex(readIndex().filter((d) => d.id !== id));
  await new Promise<void>((resolve) => {
    // Resolve either way. A blocked delete — another tab still has the
    // database open — must not leave the caller hanging; the entry is already
    // gone from the index, so the draft has disappeared from the user's view.
    const request = indexedDB.deleteDatabase(dbNameFor(id));
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
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
