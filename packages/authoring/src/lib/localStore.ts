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
  const rest = readIndex().filter((d) => d.id !== summary.id);
  const entry: DraftSummary = { id: summary.id, title: summary.title, editedAt };
  if (summary.atUri) entry.atUri = summary.atUri;
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
