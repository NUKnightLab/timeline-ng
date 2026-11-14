/**
 * Stage 0's network provider — docs/phase2-plan.md.
 *
 * Temporary by design. There is no promotion, no invitation and no access
 * control yet, so a collaboration session is entered by hand: open the app
 * with `?collab=<room>` against a dev build that has `VITE_COLLAB_URL` set,
 * and two browsers using the same room name share a document. Stage 2
 * replaces all of this with a promoted timeline and a real access check.
 *
 * **A collab session connects an empty document**, and attaches no local
 * persistence. That is [P13] in docs/phase1-sync-conflicts.md rather than a
 * shortcut: `y-indexeddb` and a network provider attached to the same `Y.Doc`
 * both load into it, and because internal slide keys are per-document random
 * (`newSlideKey`) while `unique_id` is derived from the headline, two browsers
 * that each built a document from the same published record hold the same
 * slides under different keys — so the merge yields every slide twice. The
 * rule is that a browser joining a server draft starts empty and lets the
 * provider fill it, and the cheapest way to not get that wrong later is to
 * not get it wrong now.
 *
 * One known wrinkle, harmless and worth naming: `createDoc()` stamps
 * `meta.schemaVersion` at construction, so an "empty" document is not quite
 * empty. Both browsers write the same key with the same value, so it
 * converges to the value either would have set. It stops being harmless the
 * day that stamp varies between clients.
 */
import type * as Y from 'yjs';
import { mintServiceAuth } from './atproto.svelte.ts';

/**
 * The subprotocol carrying the token, and the method it is minted for.
 *
 * A browser cannot set a header on a WebSocket, and a bearer credential has
 * no business in a URL, so it rides as the second subprotocol value. The
 * server echoes the first value back on the 101.
 */
const AUTH_PROTOCOL = 'atproto-service-auth';
const SERVICE_LXM = 'com.knightlab.drafts.connect';

/** What the provider resolves to, narrowed to what callers here need. */
export interface CollabSession {
  room: string;
  destroy: () => void;
}

/**
 * The base URL of the collaboration server, or undefined outside dev.
 *
 * Deliberately an env var with no production default: there is nothing
 * deployed to point it at, and a build that silently reached for one would be
 * worse than a build that cannot.
 */
const COLLAB_URL = import.meta.env.VITE_COLLAB_URL as string | undefined;

/** The service's own DID, which tokens are minted for. Differs per deployment. */
const COLLAB_DID = import.meta.env.VITE_COLLAB_DID as string | undefined;

/**
 * The room named by `?collab=`, when collaboration is available at all.
 *
 * Returns null — meaning "behave exactly as before" — when the env var is
 * unset, so nothing about this reaches a normal build.
 */
export function collabRoom(search = window.location.search): string | null {
  if (!COLLAB_URL) return null;
  const room = new URLSearchParams(search).get('collab');
  if (!room) return null;
  // The server accepts this character set and nothing else; failing here
  // gives a clearer error than a socket that closes without saying why.
  return /^[A-Za-z0-9_-]{1,128}$/.test(room) ? room : null;
}

/**
 * Attach a websocket provider to `doc` for `room`.
 *
 * The import is dynamic so that `y-websocket` stays out of the bundle for
 * every build that does not set `VITE_COLLAB_URL`.
 */
export async function attachCollab(doc: Y.Doc, room: string): Promise<CollabSession> {
  if (!COLLAB_DID) throw new Error('VITE_COLLAB_DID is not set.');
  const { WebsocketProvider } = await import('y-websocket');
  // y-websocket joins its two arguments with a slash, so the base carries the
  // route and the room name is the last segment: `…/draft/<room>`.
  const base = `${COLLAB_URL!.replace(/\/$/, '')}/draft`;

  const provider = new WebsocketProvider(base, room, doc, {
    protocols: [AUTH_PROTOCOL, await mintServiceAuth(COLLAB_DID, SERVICE_LXM)],
  });

  /**
   * Re-mint before reconnecting.
   *
   * Tokens last at most an hour and the server closes a socket once its token
   * expires (4401), so a long editing session *will* reconnect. y-websocket
   * reads `provider.protocols` afresh on each attempt, which makes replacing
   * the token in place the whole mechanism — and is why [P5] needs no timer.
   *
   * A failure here leaves the previous token in place: it may still be valid,
   * and a reconnect that is refused is a better outcome than one that never
   * happens because minting threw.
   */
  const refresh = () => {
    void mintServiceAuth(COLLAB_DID, SERVICE_LXM)
      .then((token) => {
        provider.protocols = [AUTH_PROTOCOL, token];
      })
      .catch(() => {});
  };
  provider.on('status', (event: { status: string }) => {
    if (event.status === 'disconnected') refresh();
  });

  return {
    room,
    destroy: () => provider.destroy(),
  };
}
