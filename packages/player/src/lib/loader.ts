import { normalizeTimelineSourceUrl, parseTimelineText } from '@knight-lab/timeline-ng-core';
import type { TLTimeline, TLEvent, TLSettings } from '@knight-lab/timeline-ng-core';

export interface LoaderConfig {
  plcDirectory?: string;
  handleResolver?: string;
}

export type LoadResult =
  | { ok: true; timeline: TLTimeline; uri: string; authorDid?: string }
  | { ok: false; error: string };

const DEFAULT_PLC = 'https://plc.directory';
const DEFAULT_RESOLVER = 'https://bsky.social';

function parseAtUri(uri: string): { authority: string; collection: string; rkey: string } | null {
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { authority: m[1], collection: m[2], rkey: m[3] };
}

async function resolveHandle(handle: string, resolver: string): Promise<string> {
  const url = `${resolver}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Handle resolution failed (${resp.status})`);
  const data = await resp.json() as { did: string };
  return data.did;
}

async function resolvePds(did: string, plcDir: string): Promise<string> {
  type DidDoc = { service?: Array<{ id: string; serviceEndpoint: string }> };
  let doc: DidDoc;
  if (did.startsWith('did:plc:')) {
    const resp = await fetch(`${plcDir}/${did}`);
    if (!resp.ok) throw new Error(`DID resolution failed (${resp.status})`);
    doc = await resp.json() as DidDoc;
  } else if (did.startsWith('did:web:')) {
    const host = did.slice('did:web:'.length);
    const resp = await fetch(`https://${host}/.well-known/did.json`);
    if (!resp.ok) throw new Error(`DID resolution failed (${resp.status})`);
    doc = await resp.json() as DidDoc;
  } else {
    throw new Error(`Unsupported DID method in: ${did}`);
  }
  const svc = doc.service?.find(s => s.id === '#atproto_pds');
  if (!svc) throw new Error('No ATProto PDS service endpoint in DID document');
  return svc.serviceEndpoint;
}

// getRecord responses do IPLD JSON decoding: blobRef.ref comes back as a CID
// class object, not the plain { $link: string } we write on upload. Handle both.
function extractCid(ref: { $link: string } | unknown): string {
  if (!ref) return '';
  if (typeof ref === 'object' && '$link' in (ref as object)) return (ref as { $link: string }).$link ?? '';
  return String(ref);
}

// Read-only playback (embed, share links) has no PDS session, so blobRef-backed
// media/background must be hydrated into fetchable getBlob URLs using the
// author's DID and PDS resolved above — mirrors the authoring app's
// hydrateBlobRefs, but for an arbitrary author rather than the signed-in user.
function hydrateBlobRefs(events: TLEvent[], pds: string, did: string): TLEvent[] {
  const cidUrl = (cid: string) => cid ? `${pds}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${encodeURIComponent(cid)}` : '';
  return events.map(ev => ({
    ...ev,
    ...(ev.media?.blobRef ? { media: { ...ev.media, url: cidUrl(extractCid(ev.media.blobRef.ref)), mimeType: ev.media.blobRef.mimeType } } : {}),
    ...(ev.background?.blobRef ? { background: { ...ev.background, url: cidUrl(extractCid(ev.background.blobRef.ref)) } } : {}),
  }));
}

function hydrateOgImage(settings: TLSettings | undefined, pds: string, did: string): TLSettings | undefined {
  const blobRef = settings?.ogImage?.blobRef;
  if (!blobRef) return settings;
  const cid = extractCid(blobRef.ref);
  if (!cid) return settings;
  return {
    ...settings,
    ogImage: { ...settings.ogImage, url: `${pds}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${encodeURIComponent(cid)}` },
  };
}

function hydrateTimeline(timeline: TLTimeline, pds: string, did: string): TLTimeline {
  return {
    ...timeline,
    events: hydrateBlobRefs(timeline.events, pds, did),
    ...(timeline.title ? { title: hydrateBlobRefs([timeline.title], pds, did)[0] } : {}),
    ...(timeline.settings ? { settings: hydrateOgImage(timeline.settings, pds, did) } : {}),
  };
}

async function fetchAtRecord(
  authority: string, collection: string, rkey: string,
  cfg: Required<LoaderConfig>,
): Promise<{ timeline: TLTimeline; did: string }> {
  const did = authority.startsWith('did:')
    ? authority
    : await resolveHandle(authority, cfg.handleResolver);
  const pds = await resolvePds(did, cfg.plcDirectory);
  const url = `${pds}/xrpc/com.atproto.repo.getRecord` +
    `?repo=${encodeURIComponent(did)}&collection=${encodeURIComponent(collection)}&rkey=${encodeURIComponent(rkey)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    let errCode = `${resp.status}`;
    try {
      const body = await resp.json() as { error?: string };
      if (body.error) errCode = body.error;
    } catch { /* ignore */ }
    throw new Error(`getRecord failed: ${errCode}`);
  }
  const record = await resp.json() as { value?: { timeline?: TLTimeline } };
  if (!record.value?.timeline) throw new Error('Record has no timeline field');
  return { timeline: hydrateTimeline(record.value.timeline, pds, did), did };
}

async function fetchHttpTimeline(url: string): Promise<TLTimeline> {
  const resp = await fetch(normalizeTimelineSourceUrl(url));
  if (!resp.ok) throw new Error(`Fetch failed (${resp.status})`);
  return parseTimelineText(await resp.text());
}

export async function loadTimeline(source: string, config: LoaderConfig = {}): Promise<LoadResult> {
  const cfg: Required<LoaderConfig> = {
    plcDirectory: config.plcDirectory ?? DEFAULT_PLC,
    handleResolver: config.handleResolver ?? DEFAULT_RESOLVER,
  };
  try {
    if (source.startsWith('at://')) {
      const parts = parseAtUri(source);
      if (!parts) return { ok: false, error: `Invalid AT URI: ${source}` };
      const { timeline, did } = await fetchAtRecord(parts.authority, parts.collection, parts.rkey, cfg);
      const canonicalUri = `at://${did}/${parts.collection}/${parts.rkey}`;
      return { ok: true, timeline, uri: canonicalUri, authorDid: did };
    }
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const timeline = await fetchHttpTimeline(source);
      return { ok: true, timeline, uri: source };
    }
    return { ok: false, error: 'Expected an at:// URI or http(s):// URL' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
