/**
 * One Durable Object per promoted timeline — docs/phase2-plan.md Stage 0.
 *
 * Stage 0 is deliberately a throwaway: no authentication, no access control,
 * no R2, and a room name taken straight from the URL. What it is here to
 * settle is [R1] and [R4] — that a Durable Object can hold a Yjs document
 * under hibernation, and that the authoring editor accepts a change it did
 * not make.
 *
 * **Written against the hibernation API from the start** ([P2]). That is not
 * an optimization to retrofit: `ctx.acceptWebSocket()` lets the object be
 * evicted from memory while its sockets stay open, and an evicted object runs
 * its constructor again on the next message with every class field reset. A
 * server that keeps the document in a field and assumes it survives is
 * correct in `wrangler dev` and wrong in production the first time an editor
 * pauses to think — which, for this workload, is most of the time.
 *
 * So the document is reloaded from storage on each wake and the in-memory
 * copy is only ever a cache. See `#doc()`.
 */
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { AUTH_PROTOCOL, DID_HEADER, EXPIRY_HEADER } from './authProtocol.ts';

/** y-websocket's two message kinds. Awareness is relayed, never interpreted. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Storage key holding the compacted document as a single merged update. */
const DOC_KEY = 'doc';

/**
 * Prefix for updates that have arrived since the last compaction.
 *
 * **Keys need only be unique, not ordered.** Yjs updates are commutative —
 * applying them in any order converges on the same document — so there is no
 * sequence number to keep, and therefore nothing that breaks when the object
 * is evicted and loses whatever counter it was holding.
 */
const PENDING_PREFIX = 'u:';

/**
 * How long after a change the room compacts its pending updates into one.
 *
 * This is a storage-shape optimization, not a durability mechanism: every
 * update is already durable before its message is acknowledged. Compaction
 * only bounds how many rows a busy room accumulates, so the delay can be
 * generous.
 */
const COMPACT_DELAY_MS = 10_000;

export class DraftRoom implements DurableObject {
  #cached: Y.Doc | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: unknown,
  ) {}

  /**
   * The room's document.
   *
   * Reloaded from storage whenever the in-memory copy is missing, which is
   * every wake from hibernation as well as the first message after creation.
   * Callers must not hold the return value across an `await`.
   */
  async #doc(): Promise<Y.Doc> {
    if (this.#cached) return this.#cached;
    const doc = new Y.Doc();
    const stored = await this.ctx.storage.get<ArrayBuffer>(DOC_KEY);
    if (stored) Y.applyUpdate(doc, new Uint8Array(stored));
    // Anything written since the last compaction. Order does not matter.
    const pending = await this.ctx.storage.list<ArrayBuffer>({ prefix: PENDING_PREFIX });
    for (const value of pending.values()) Y.applyUpdate(doc, new Uint8Array(value));
    this.#cached = doc;
    return doc;
  }

  /**
   * Make an update durable, and make sure a compaction is coming.
   *
   * **Awaited, not deferred.** The first version of this debounced the write
   * behind `ctx.waitUntil(scheduler.wait(...))`, which loses data: a timer is
   * not durable, and a room that goes quiet — the normal case for an editor —
   * is evicted before it fires, taking the pending write with it. Local
   * Durable Object storage showed the symptom plainly: the room exercised by a
   * four-second script had a `doc` key, while the room edited through a
   * browser over several minutes had no storage at all.
   *
   * So the update is written before its message is acknowledged, and the
   * alarm only merges what has accumulated. Alarms, unlike timers, are
   * persisted by the platform and wake the object to run.
   */
  async #persist(update: Uint8Array): Promise<void> {
    await this.ctx.storage.put(PENDING_PREFIX + crypto.randomUUID(), update);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + COMPACT_DELAY_MS);
    }
  }

  /**
   * Merge the pending updates into the stored document.
   *
   * Purely housekeeping: the room reads the same either side of this, since
   * `#doc()` replays whatever has not been compacted yet. Deleting the pending
   * keys after the merge is what keeps a long editing session from growing an
   * unbounded number of rows.
   */
  async alarm(): Promise<void> {
    const doc = await this.#doc();
    const pending = await this.ctx.storage.list({ prefix: PENDING_PREFIX });
    await this.ctx.storage.put(DOC_KEY, Y.encodeStateAsUpdate(doc));
    if (pending.size) await this.ctx.storage.delete([...pending.keys()]);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    // Set by the entry point, which does not forward a request it has not
    // authenticated. A room is never reachable from outside it.
    const did = request.headers.get(DID_HEADER);
    const expiry = Number(request.headers.get(EXPIRY_HEADER));
    if (!did || !Number.isFinite(expiry)) {
      return new Response('Unauthenticated.', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Not `server.accept()`. That keeps the object pinned in memory for as
    // long as the socket is open, which is the entire bill for this workload.
    //
    // The DID is a tag so it survives hibernation and `getWebSockets(did)`
    // can find a person's sockets — which is what Stage 2's access control
    // will revoke against. The expiry rides in the attachment beside it.
    this.ctx.acceptWebSocket(server, [did]);
    server.serializeAttachment({ did, expiry });

    // Echoing the subprotocol is not optional: a browser that offered one and
    // is answered without it fails the connection.
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': AUTH_PROTOCOL },
    });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    if (this.#expired(ws)) return;
    if (typeof raw === 'string') return; // y-websocket speaks binary only.
    const message = new Uint8Array(raw);
    const decoder = decoding.createDecoder(message);
    const kind = decoding.readVarUint(decoder);

    if (kind === MESSAGE_AWARENESS) {
      // Cursors and selections. The server has no opinion about them and no
      // reason to decode them; they are other clients' business.
      this.#broadcast(message, ws);
      return;
    }
    if (kind !== MESSAGE_SYNC) return;

    const doc = await this.#doc();
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);

    // Collects what this message actually changed, so an update is relayed and
    // stored while a sync handshake is neither.
    const changes: Uint8Array[] = [];
    const onUpdate = (update: Uint8Array) => {
      changes.push(update);
    };
    doc.on('update', onUpdate);
    try {
      syncProtocol.readSyncMessage(decoder, reply, doc, null);
    } finally {
      doc.off('update', onUpdate);
    }

    // readSyncMessage writes a reply only when the peer asked for one —
    // length 1 is the bare message type with nothing after it.
    if (encoding.length(reply) > 1) {
      ws.send(encoding.toUint8Array(reply));
    }
    if (changes.length) {
      this.#broadcast(message, ws);
      // One row per message rather than per update, which matters because
      // rows-written is the tightest limit on the free plan (§10.8).
      await this.#persist(changes.length === 1 ? changes[0] : Y.mergeUpdates(changes));
    }
  }

  /**
   * Close a socket whose token has run out, and say so distinctly.
   *
   * Checked on activity rather than by a timer, which is [P5] satisfied by the
   * shape of the thing: service auth tokens last an hour at most, so a client
   * has to re-mint anyway, and re-presenting one on reconnect *is* the
   * re-check. A timer would also not survive hibernation, which is the lesson
   * `#persist` already learned.
   */
  #expired(ws: WebSocket): boolean {
    const attachment = ws.deserializeAttachment() as { expiry?: number } | null;
    if (!attachment?.expiry || Date.now() / 1000 <= attachment.expiry) return false;
    // 4401: application-defined, and deliberately not 1008 — the client needs
    // to tell "get a new token and come back" from "you are not allowed here".
    ws.close(4401, 'service auth token expired');
    return true;
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // 1006 is "abnormal closure", which a client may not send back.
    ws.close(code === 1006 ? 1000 : code, reason);
  }

  /** Send to every socket except the one it came from. */
  #broadcast(message: Uint8Array, from: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === from) continue;
      try {
        socket.send(message);
      } catch {
        // A socket that is already gone is not this message's problem.
      }
    }
  }
}
