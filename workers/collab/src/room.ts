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

/** y-websocket's two message kinds. Awareness is relayed, never interpreted. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

/** Storage key holding the document as a single merged update. */
const DOC_KEY = 'doc';

/**
 * How long writes are coalesced before one hits storage.
 *
 * Rows-written is the tightest limit on the free plan (§10.8) and Yjs is
 * chatty while someone is actively typing, so a row per update is the one
 * cost model to avoid. Batching is standard practice for Yjs providers
 * regardless of who is paying.
 */
const PERSIST_DEBOUNCE_MS = 2_000;

export class DraftRoom implements DurableObject {
  #cached: Y.Doc | null = null;
  #persistQueued = false;

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
    this.#cached = doc;
    return doc;
  }

  /**
   * Write the merged document back, at most once per debounce window.
   *
   * `waitUntil` rather than a bare promise: the object may be evicted as soon
   * as the message that triggered this returns, and an un-awaited write would
   * be cancelled with it.
   */
  #schedulePersist(doc: Y.Doc): void {
    if (this.#persistQueued) return;
    this.#persistQueued = true;
    this.ctx.waitUntil(
      (async () => {
        await scheduler.wait(PERSIST_DEBOUNCE_MS);
        this.#persistQueued = false;
        await this.ctx.storage.put(DOC_KEY, Y.encodeStateAsUpdate(doc));
      })(),
    );
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade.', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Not `server.accept()`. That keeps the object pinned in memory for as
    // long as the socket is open, which is the entire bill for this workload.
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
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

    // Tracks whether this message changed the document, so an update is
    // relayed to the other sockets but a sync handshake is not.
    let changed = false;
    const onUpdate = () => {
      changed = true;
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
    if (changed) {
      this.#broadcast(message, ws);
      this.#schedulePersist(doc);
    }
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
