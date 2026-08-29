// Browser-local cache of fully-enumerated atmosphere collections.
//
// The repo browser filters client-side, which means it needs every record in a
// collection rather than a page at a time. Walking a few hundred records over
// listRecords is slow enough to be worth not repeating on every visit to the
// media editor, so completed enumerations are parked in localStorage keyed by
// (did, collection) and re-used until they age out.

import type { CollectionMediaItem } from './atproto.svelte.ts';

const VERSION = 2;
const KEY_PREFIX = `tl-media-cache:v${VERSION}:`;

/** How long a cached enumeration is served without a background refresh. */
export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// localStorage is a shared ~5MB budget; refuse to spend most of it on one
// collection. Records are small (blob ref + a little text), so this is a few
// thousand items in practice.
const MAX_ENTRY_BYTES = 1_500_000;

export type CachedCollection = {
  items: CollectionMediaItem[];
  fetchedAt: number;
  /** True when enumeration stopped at the record cap rather than the end. */
  truncated: boolean;
};

type StoredEntry = CachedCollection & { did: string; nsid: string };

function keyFor(did: string, nsid: string): string {
  return `${KEY_PREFIX}${did}:${nsid}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // Safari private mode, blocked third-party context, etc.
  }
}

export function readCachedCollection(did: string, nsid: string): CachedCollection | null {
  const store = storage();
  if (!store || !did || !nsid) return null;
  let raw: string | null;
  try {
    raw = store.getItem(keyFor(did, nsid));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as StoredEntry;
    if (!Array.isArray(entry.items) || typeof entry.fetchedAt !== 'number') return null;
    return { items: entry.items, fetchedAt: entry.fetchedAt, truncated: !!entry.truncated };
  } catch {
    // Corrupt or written by an incompatible build — drop it.
    try { store.removeItem(keyFor(did, nsid)); } catch { /* ignore */ }
    return null;
  }
}

export function isStale(entry: CachedCollection, now = Date.now()): boolean {
  return now - entry.fetchedAt > CACHE_TTL_MS;
}

export function writeCachedCollection(
  did: string,
  nsid: string,
  items: CollectionMediaItem[],
  truncated = false,
): void {
  const store = storage();
  if (!store || !did || !nsid) return;
  const entry: StoredEntry = { did, nsid, items, fetchedAt: Date.now(), truncated };
  let json: string;
  try {
    json = JSON.stringify(entry);
  } catch {
    return;
  }
  if (json.length > MAX_ENTRY_BYTES) return;
  try {
    store.setItem(keyFor(did, nsid), json);
  } catch {
    // Almost certainly a quota error. Evict every media cache entry and retry
    // once; caching is an optimization, so give up quietly if that fails too.
    clearMediaCache();
    try { store.setItem(keyFor(did, nsid), json); } catch { /* ignore */ }
  }
}

/** Drop cached collections. Scoped to one did/nsid when given, otherwise all. */
export function clearMediaCache(did?: string, nsid?: string): void {
  const store = storage();
  if (!store) return;
  const prefix = did ? (nsid ? keyFor(did, nsid) : `${KEY_PREFIX}${did}:`) : KEY_PREFIX;
  const doomed: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(prefix)) doomed.push(k);
    }
    for (const k of doomed) store.removeItem(k);
  } catch {
    // ignore
  }
}
