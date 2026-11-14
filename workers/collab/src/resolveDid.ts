/**
 * Turning a DID into the document that holds its signing key.
 *
 * Only the two methods atproto actually uses. Anything else is refused rather
 * than attempted: the DID here comes out of a token an unauthenticated client
 * handed us, so the set of things it can make us fetch should be small and
 * stated.
 *
 * On SSRF: `did:web` means the issuer chooses a hostname we then fetch, which
 * is inherent to the method. Workers' outbound fetch does not reach private
 * address space, so the usual internal-service worry does not apply the way it
 * would on a Node server — the devnet notes in docs/atproto-devnet.md describe
 * the mirror image of this problem, where atproto's own SSRF guard refuses to
 * fetch a local client metadata URL. Still worth keeping the method list short.
 */
import type { DidDocument } from './serviceAuth.ts';

/** How long a resolved document is reused. */
const CACHE_TTL_SECONDS = 300;

export interface ResolveEnv {
  /** PLC directory base URL. Overridden in dev to reach the local PLC. */
  PLC_URL?: string;
}

const DEFAULT_PLC = 'https://plc.directory';

/** Where a DID's document lives, or null if we do not resolve that method. */
export function didDocumentUrl(did: string, env: ResolveEnv): string | null {
  if (did.startsWith('did:plc:')) {
    const id = did.slice('did:plc:'.length);
    // PLC identifiers are base32; anything else is not worth a round trip.
    if (!/^[a-z2-7]{24}$/.test(id)) return null;
    return `${(env.PLC_URL ?? DEFAULT_PLC).replace(/\/$/, '')}/${did}`;
  }

  if (did.startsWith('did:web:')) {
    const rest = did.slice('did:web:'.length);
    // did:web encodes path segments with colons and the port with %3A.
    const [host, ...path] = rest.split(':');
    const decodedHost = decodeURIComponent(host);
    if (!/^[A-Za-z0-9.\-]+(:[0-9]+)?$/.test(decodedHost)) return null;
    const suffix = path.length ? `/${path.map(decodeURIComponent).join('/')}/did.json` : '/.well-known/did.json';
    return `https://${decodedHost}${suffix}`;
  }

  return null;
}

/**
 * Fetch and cache a DID document.
 *
 * Cached through the Workers cache rather than an instance field: a Durable
 * Object is evicted whenever it goes idle, so anything held in memory is a
 * cache with a lifetime nobody chose.
 */
export async function resolveDid(did: string, env: ResolveEnv): Promise<DidDocument | null> {
  const url = didDocumentUrl(did, env);
  if (!url) return null;

  const cacheKey = new Request(url, { method: 'GET' });
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;

  const cached = await cache?.match(cacheKey);
  if (cached) return (await cached.json()) as DidDocument;

  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: 'application/did+json, application/json' } });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const body = await response.text();
  let doc: DidDocument;
  try {
    doc = JSON.parse(body) as DidDocument;
  } catch {
    return null;
  }

  await cache?.put(
    cacheKey,
    new Response(body, {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_TTL_SECONDS}` },
    }),
  );
  return doc;
}
