import { normalizeTimelineSourceUrl, parseTimelineText } from '@knight-lab/timeline-ng-core';
import type { TLTimeline } from '@knight-lab/timeline-ng-core';

export interface LoaderConfig {
  plcDirectory?: string;
  handleResolver?: string;
}

export type LoadResult =
  | { ok: true; timeline: TLTimeline; uri: string }
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

async function fetchAtRecord(
  authority: string, collection: string, rkey: string,
  cfg: Required<LoaderConfig>,
): Promise<TLTimeline> {
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
  return record.value.timeline;
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
      const timeline = await fetchAtRecord(parts.authority, parts.collection, parts.rkey, cfg);
      return { ok: true, timeline, uri: source };
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
