import { describe, it, expect } from 'vitest';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';
import { reconcile } from './reconcile.ts';

const moon: TLEvent = { unique_id: 'moon', start_date: { year: 1969 }, text: { headline: 'The Moon Landing' } };
const sputnik: TLEvent = { unique_id: 'sputnik', start_date: { year: 1957 }, text: { headline: 'Sputnik 1' } };

const tl = (events: TLEvent[]): TLTimeline => ({ events });
const BASE = 'bafyreibase';
const MOVED = 'bafyreimoved';

describe('reconcile', () => {
  it('says nothing when neither side moved', () => {
    const r = reconcile({
      localClean: true, baseCid: BASE, publishedCid: BASE,
      base: tl([moon]), mine: tl([moon]), published: tl([moon]),
    });
    expect(r.kind).toBe('in-sync');
  });

  it('leaves ordinary unpublished edits alone', () => {
    const r = reconcile({
      localClean: false, baseCid: BASE, publishedCid: BASE,
      base: tl([moon]), mine: tl([moon, sputnik]), published: tl([moon]),
    });
    expect(r.kind).toBe('local-only');
  });

  it('fast-forwards when the record moved and nothing local is at risk', () => {
    const r = reconcile({
      localClean: true, baseCid: BASE, publishedCid: MOVED,
      base: tl([moon]), mine: tl([moon]), published: tl([moon, sputnik]),
    });
    expect(r).toMatchObject({ kind: 'fast-forward' });
  });

  it('merges without asking when the two sides touched different slides', () => {
    const vostok: TLEvent = { unique_id: 'vostok', start_date: { year: 1961 }, text: { headline: 'Vostok 1' } };
    const r = reconcile({
      localClean: false, baseCid: BASE, publishedCid: MOVED,
      base: tl([moon]), mine: tl([moon, vostok]), published: tl([moon, sputnik]),
    });
    expect(r.kind).toBe('merged');
    if (r.kind !== 'merged') return;
    expect(r.timeline.events.map((e) => e.unique_id).sort()).toEqual(['moon', 'sputnik', 'vostok']);
    // The record itself, not the merge, is what the next comparison needs as
    // its base — it is what the PDS holds.
    expect(r.published.events.map((e) => e.unique_id)).toEqual(['moon', 'sputnik']);
  });

  it('asks only when the two sides genuinely collide', () => {
    const r = reconcile({
      localClean: false, baseCid: BASE, publishedCid: MOVED,
      base: tl([moon]),
      mine: tl([{ ...moon, group: 'Missions' }]),
      published: tl([{ ...moon, group: 'Apollo' }]),
    });
    expect(r.kind).toBe('conflict');
  });

  it('cannot answer without a base', () => {
    // A draft from before base CIDs. Saying "in sync" here is the original bug.
    const r = reconcile({
      localClean: true, baseCid: undefined, publishedCid: MOVED,
      base: null, mine: tl([moon]), published: tl([moon, sputnik]),
    });
    expect(r.kind).toBe('unknown');
  });

  it('cannot answer when the record could not be read', () => {
    // Script 8: no claim either way.
    const r = reconcile({
      localClean: false, baseCid: BASE, publishedCid: MOVED,
      base: tl([moon]), mine: tl([moon, sputnik]), published: null,
    });
    expect(r.kind).toBe('unknown');
  });

  it('still asks when both sides moved and the base is missing', () => {
    // The comparison cannot attribute anything, but someone's work is at risk,
    // so this must not fall through to saying nothing.
    const r = reconcile({
      localClean: false, baseCid: BASE, publishedCid: MOVED,
      base: null, mine: tl([moon, sputnik]), published: tl([moon]),
    });
    expect(r.kind).toBe('conflict');
    if (r.kind !== 'conflict') return;
    expect(r.analysis.mine).toEqual([]);
    expect(r.analysis.theirs).toEqual([]);
  });
});
