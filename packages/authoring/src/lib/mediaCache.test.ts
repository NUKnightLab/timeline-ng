import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionMediaItem } from './atproto.svelte.ts';
import {
  CACHE_TTL_MS, clearMediaCache, isStale, readCachedCollection, writeCachedCollection,
} from './mediaCache.ts';

const DID = 'did:plc:testuser';
const NSID = 'social.grain.photo';

// These tests run under vitest's default node environment, so stand up just
// enough of window.localStorage for the module under test.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

let store: MemoryStorage;

function item(uri: string): CollectionMediaItem {
  return {
    uri,
    nsid: NSID,
    media: { blobRef: { $type: 'blob', ref: { $link: 'bafy1' }, mimeType: 'image/jpeg', size: 10 } },
    label: 'A heron',
    searchText: 'a heron',
  };
}

describe('mediaCache', () => {
  beforeEach(() => {
    store = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: store });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null for an unseen collection', () => {
    expect(readCachedCollection(DID, NSID)).toBeNull();
  });

  it('round-trips items', () => {
    writeCachedCollection(DID, NSID, [item('at://a/1'), item('at://a/2')]);
    const entry = readCachedCollection(DID, NSID);
    expect(entry?.items.map(i => i.uri)).toEqual(['at://a/1', 'at://a/2']);
    expect(entry?.truncated).toBe(false);
    expect(entry?.fetchedAt).toBeGreaterThan(0);
  });

  it('preserves the truncated flag', () => {
    writeCachedCollection(DID, NSID, [item('at://a/1')], true);
    expect(readCachedCollection(DID, NSID)?.truncated).toBe(true);
  });

  it('scopes entries per did and per collection', () => {
    writeCachedCollection(DID, NSID, [item('at://a/1')]);
    expect(readCachedCollection('did:plc:other', NSID)).toBeNull();
    expect(readCachedCollection(DID, 'fm.plyr.track')).toBeNull();
  });

  it('reports staleness against the TTL', () => {
    const fresh = { items: [], fetchedAt: Date.now(), truncated: false };
    expect(isStale(fresh)).toBe(false);
    const old = { items: [], fetchedAt: Date.now() - CACHE_TTL_MS - 1000, truncated: false };
    expect(isStale(old)).toBe(true);
  });

  it('drops and reports null on corrupt JSON', () => {
    store.setItem(`tl-media-cache:v2:${DID}:${NSID}`, '{not json');
    expect(readCachedCollection(DID, NSID)).toBeNull();
    expect(store.getItem(`tl-media-cache:v2:${DID}:${NSID}`)).toBeNull();
  });

  it('rejects entries missing the expected shape', () => {
    store.setItem(`tl-media-cache:v2:${DID}:${NSID}`, '{"items":"nope"}');
    expect(readCachedCollection(DID, NSID)).toBeNull();
  });

  it('clears a single collection, a whole did, or everything', () => {
    writeCachedCollection(DID, NSID, [item('at://a/1')]);
    writeCachedCollection(DID, 'fm.plyr.track', [item('at://a/2')]);
    writeCachedCollection('did:plc:other', NSID, [item('at://a/3')]);

    clearMediaCache(DID, NSID);
    expect(readCachedCollection(DID, NSID)).toBeNull();
    expect(readCachedCollection(DID, 'fm.plyr.track')).not.toBeNull();

    clearMediaCache(DID);
    expect(readCachedCollection(DID, 'fm.plyr.track')).toBeNull();
    expect(readCachedCollection('did:plc:other', NSID)).not.toBeNull();

    clearMediaCache();
    expect(readCachedCollection('did:plc:other', NSID)).toBeNull();
  });

  it('leaves unrelated localStorage keys alone', () => {
    store.setItem('tl-post-auth-view', 'editor');
    writeCachedCollection(DID, NSID, [item('at://a/1')]);
    clearMediaCache();
    expect(store.getItem('tl-post-auth-view')).toBe('editor');
  });

  it('evicts every media entry and retries once when the quota is exceeded', () => {
    writeCachedCollection('did:plc:other', NSID, [item('at://a/9')]);
    const real = store.setItem.bind(store);
    let calls = 0;
    store.setItem = (k: string, v: string) => {
      calls += 1;
      if (calls === 1) throw new Error('QuotaExceededError');
      real(k, v);
    };
    writeCachedCollection(DID, NSID, [item('at://a/1')]);
    store.setItem = real;
    expect(readCachedCollection(DID, NSID)?.items).toHaveLength(1);
    expect(readCachedCollection('did:plc:other', NSID)).toBeNull(); // evicted
  });

  it('skips caching an entry that is too large to be worth storing', () => {
    const huge = Array.from({ length: 40_000 }, (_, i) => item(`at://a/${i}`));
    writeCachedCollection(DID, NSID, huge);
    expect(readCachedCollection(DID, NSID)).toBeNull();
  });
});
