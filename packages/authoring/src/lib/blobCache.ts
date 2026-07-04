// Session-scoped cache of CID → local object URL, populated after upload.
// Lets EventEditor instances recreated via {#key} find the local URL without
// hitting getBlob (which only works after the record containing the blob is committed).
const _cache = new Map<string, string>();

export function cacheLocalBlobUrl(cid: string, objectUrl: string): void {
  _cache.set(cid, objectUrl);
}

export function getCachedBlobUrl(cid: string): string | undefined {
  return _cache.get(cid);
}

