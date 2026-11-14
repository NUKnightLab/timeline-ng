/**
 * The collaboration server's entry point — docs/phase2-plan.md Stages 0–1.
 *
 * Routes `/draft/<id>` to that draft's Durable Object, and only after the
 * connecting client has proved who it is ([P4]). Stage 2 adds promotion and
 * access control: this says *who you are*, not yet *whether you may*.
 *
 * Note what is absent from `package.json`: `@knight-lab/timeline-ng-core`.
 * The service syncs a Yjs document and knows nothing about timelines — [P25],
 * which is coauthoring.md §10.6's seam written as a dependency list.
 */
import { AUTH_PROTOCOL, DID_HEADER, EXPIRY_HEADER } from './authProtocol.ts';
import { resolveDid, type ResolveEnv } from './resolveDid.ts';
import { verifyServiceAuth } from './serviceAuth.ts';

export { DraftRoom } from './room.ts';

export interface Env extends ResolveEnv {
  DRAFT: DurableObjectNamespace;
  /** Our own DID. A token minted for anyone else is refused. */
  SERVICE_DID: string;
  /** The single `lxm` we accept — [P27]. */
  SERVICE_LXM: string;
}

/** The header is a comma-separated list, in the client's order of preference. */
function protocols(request: Request): string[] {
  return (request.headers.get('Sec-WebSocket-Protocol') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = /^\/draft\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname);
    if (!match) return new Response('Not found.', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }

    const [marker, token] = protocols(request);
    if (marker !== AUTH_PROTOCOL || !token) {
      return new Response('Authentication required.', { status: 401 });
    }

    // Read the issuer before verifying anything, purely to know whose document
    // to fetch. Nothing is trusted until the signature checks out against it.
    const unverifiedIssuer = readIssuer(token);
    if (!unverifiedIssuer) return new Response('Malformed token.', { status: 401 });

    const didDocument = await resolveDid(unverifiedIssuer, env);
    if (!didDocument) return new Response('Could not resolve the issuer.', { status: 401 });

    const result = verifyServiceAuth({
      token,
      audience: env.SERVICE_DID,
      method: env.SERVICE_LXM,
      didDocument,
      now: Math.floor(Date.now() / 1000),
    });
    if (!result.ok) {
      // The reason is safe to return: everything in it is about the token the
      // caller just presented, and a client that cannot tell "expired" from
      // "wrong audience" cannot do the right thing about either.
      return new Response(result.reason, { status: 401 });
    }

    // idFromName, not newUniqueId: the same draft id must reach the same
    // object from every browser, which is the whole point of a DO here.
    const id = env.DRAFT.idFromName(match[1]);
    const forwarded = new Request(request);
    forwarded.headers.set(DID_HEADER, result.did);
    forwarded.headers.set(EXPIRY_HEADER, String(result.claims.exp));
    return env.DRAFT.get(id).fetch(forwarded);
  },
};

/** The `iss` claim, read without verifying. Only used to find the key. */
function readIssuer(token: string): string | null {
  const body = token.split('.')[1];
  if (!body) return null;
  try {
    const json = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
      ),
    ) as { iss?: unknown };
    return typeof json.iss === 'string' && json.iss.startsWith('did:') ? json.iss : null;
  } catch {
    return null;
  }
}
