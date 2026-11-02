/**
 * Comparing a local draft against the published record it came from.
 *
 * Three copies are in play and they are not equal (see
 * `docs/phase1-sync-conflicts.md`): the local draft is a Yjs document with
 * full history, the published record is plain JSON on the PDS with none. Only
 * the record can genuinely conflict, because only it has no history to merge
 * through.
 *
 * Two facts recorded on the document answer the two halves. The published
 * snapshot says whether the draft has moved since the version it agreed with;
 * the base CID says whether the record has. This module does nothing but put
 * them together.
 */

/**
 * What the two comparisons add up to.
 *
 * - `in-sync` — neither moved.
 * - `fast-forward` — the record moved and the draft did not, so nothing local
 *   is at risk and nothing needs asking.
 * - `local-only` — ordinary unpublished edits.
 * - `conflict` — both moved. The only case that needs a decision.
 * - `unknown` — there is no base to compare against, so neither question can
 *   be answered. A draft from before the base CID was recorded, a PDS that
 *   returned no CID, or a draft that has never been published.
 */
export type SyncState = 'in-sync' | 'fast-forward' | 'local-only' | 'conflict' | 'unknown';

export interface SyncInputs {
  /** Whether the document still matches its published snapshot. */
  localClean: boolean;
  /** The version the draft last agreed with, from the document's meta. */
  baseCid: string | null | undefined;
  /**
   * The record's current version, from `listTimelines` or `getTimeline`.
   * Null or absent when the record is gone or was never fetched.
   */
  publishedCid: string | null | undefined;
}

export function syncState({ localClean, baseCid, publishedCid }: SyncInputs): SyncState {
  // No common ancestor, no three-way comparison. Deliberately not guessed at
  // from timestamps: `createdAt` is rewritten on every publish, so it is an
  // update time wearing the wrong name, and clocks skew besides.
  if (!baseCid || !publishedCid) return 'unknown';

  const publishedMoved = publishedCid !== baseCid;
  if (localClean) return publishedMoved ? 'fast-forward' : 'in-sync';
  return publishedMoved ? 'conflict' : 'local-only';
}

