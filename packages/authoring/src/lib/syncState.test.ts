import { describe, it, expect } from 'vitest';
import { syncState } from './syncState.ts';

const BASE = 'bafyreibase';
const MOVED = 'bafyreimoved';

describe('syncState', () => {
  it('is in sync when neither side moved', () => {
    expect(syncState({ localClean: true, baseCid: BASE, publishedCid: BASE })).toBe('in-sync');
  });

  it('is a fast-forward when only the record moved', () => {
    expect(syncState({ localClean: true, baseCid: BASE, publishedCid: MOVED })).toBe('fast-forward');
  });

  it('is local-only when only the draft moved', () => {
    expect(syncState({ localClean: false, baseCid: BASE, publishedCid: BASE })).toBe('local-only');
  });

  it('is a conflict when both moved', () => {
    expect(syncState({ localClean: false, baseCid: BASE, publishedCid: MOVED })).toBe('conflict');
  });

  it('is unknown without a base to compare against', () => {
    // A draft from before the base CID was recorded. Not the same as in-sync:
    // the two questions cannot be answered at all, and answering them wrongly
    // is exactly how a stale draft gets published over a newer record.
    expect(syncState({ localClean: true, baseCid: undefined, publishedCid: MOVED })).toBe('unknown');
    expect(syncState({ localClean: false, baseCid: null, publishedCid: BASE })).toBe('unknown');
  });

  it('is unknown when the record has no CID to offer', () => {
    expect(syncState({ localClean: false, baseCid: BASE, publishedCid: null })).toBe('unknown');
  });
});
