import { beforeEach, describe, expect, it } from 'vitest';
import { cacheLocalBlobUrl, getCachedBlobUrl } from './blobCache.ts';

// The cache is module-level state; reset between tests by re-importing a fresh module.
// Vitest isolates modules per test file but not per test, so we clear manually.
// Since we can't easily reset a Map in a closed module, we work with known-unique CIDs per test.

describe('blobCache', () => {
  const CID_A = 'bafytest000aaaa';
  const CID_B = 'bafytest000bbbb';
  const URL_A = 'blob:http://localhost/fake-a';
  const URL_A2 = 'blob:http://localhost/fake-a-v2';
  const URL_B = 'blob:http://localhost/fake-b';

  it('returns undefined for unknown CID', () => {
    expect(getCachedBlobUrl('bafyunknown')).toBeUndefined();
  });

  it('stores and retrieves a URL by CID', () => {
    cacheLocalBlobUrl(CID_A, URL_A);
    expect(getCachedBlobUrl(CID_A)).toBe(URL_A);
  });

  it('overwrites a CID entry with a new URL', () => {
    cacheLocalBlobUrl(CID_A, URL_A);
    cacheLocalBlobUrl(CID_A, URL_A2);
    expect(getCachedBlobUrl(CID_A)).toBe(URL_A2);
  });

  it('stores multiple CIDs independently', () => {
    cacheLocalBlobUrl(CID_A, URL_A);
    cacheLocalBlobUrl(CID_B, URL_B);
    expect(getCachedBlobUrl(CID_A)).toBe(URL_A);
    expect(getCachedBlobUrl(CID_B)).toBe(URL_B);
  });
});
