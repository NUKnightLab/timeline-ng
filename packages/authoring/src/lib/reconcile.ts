/**
 * What to do when a local draft and its published record have both moved.
 *
 * Kept apart from the components because it is the decision, not the
 * presentation: given the two comparisons and the three versions, this says
 * which of the scripts in `docs/phase1-sync-conflicts.md` applies. The caller
 * does the fetching and the asking.
 */
import type { TLTimeline } from '@knight-lab/timeline-ng-core';
import { syncState } from './syncState.ts';
import { threeWay } from './threeWay.ts';
import type { ThreeWay } from './threeWay.ts';

export type Reconciliation =
  /** Script 2 — nothing to say. */
  | { kind: 'in-sync' }
  /** Script 4 — ordinary unpublished edits, which the editor already shows. */
  | { kind: 'local-only' }
  /** Script 3 — the record moved and nothing local is at risk. */
  | { kind: 'fast-forward'; published: TLTimeline }
  /** [P9] — both moved, nothing collides, so no one is asked anything. */
  | { kind: 'merged'; timeline: TLTimeline; published: TLTimeline; analysis: ThreeWay }
  /** Scripts 5 and 6 — a real collision, which only a person can settle. */
  | { kind: 'conflict'; published: TLTimeline | null; analysis: ThreeWay }
  /** Script 8, and drafts with no base: the comparison could not run. */
  | { kind: 'unknown' };

export interface ReconcileInputs {
  localClean: boolean;
  baseCid: string | null | undefined;
  publishedCid: string | null | undefined;
  /** The version both sides agreed with, from `publishedSnapshot`. */
  base: TLTimeline | null;
  /** This browser's draft. */
  mine: TLTimeline;
  /** The published record as it is now. */
  published: TLTimeline | null;
}

export function reconcile({ localClean, baseCid, publishedCid, base, mine, published }: ReconcileInputs): Reconciliation {
  const state = syncState({ localClean, baseCid, publishedCid });
  if (state === 'unknown') return { kind: 'unknown' };
  if (state === 'in-sync') return { kind: 'in-sync' };
  if (state === 'local-only') return { kind: 'local-only' };

  // From here the record has moved, so its content is needed. A caller that
  // could not fetch it knows no more than Script 8 does.
  if (!published) return { kind: 'unknown' };
  if (state === 'fast-forward') return { kind: 'fast-forward', published };

  // Both sides moved and there is no base to compare through. The comparison
  // degrades to a two-way that cannot attribute a change to a side, so it says
  // nothing rather than guessing — but it still asks, because this is the one
  // case where someone's work is genuinely at risk.
  if (!base) return { kind: 'conflict', published, analysis: { mine: [], theirs: [], collisions: [], merged: null } };

  const analysis = threeWay(base, mine, published);
  if (analysis.merged) return { kind: 'merged', timeline: analysis.merged, published, analysis };
  return { kind: 'conflict', published, analysis };
}
