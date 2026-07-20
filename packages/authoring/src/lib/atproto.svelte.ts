import { BrowserOAuthClient } from '@atproto/oauth-client-browser';
import type { OAuthSession } from '@atproto/oauth-client-browser';
import { Agent } from '@atproto/api';
import type { ATProtoBlobRef, TLEvent, TLMedia, TLSettings, TLTimeline } from '@knight-lab/timeline-ng-core';
import { collections } from './collections.ts';
import type { CollectionDef } from './collections.ts';

// ── Config ──────────────────────────────────────────────────────────────────

const PLC_URL = import.meta.env.VITE_ATPROTO_PLC_URL as string | undefined;
const HANDLE_RESOLVER = import.meta.env.VITE_ATPROTO_HANDLE_RESOLVER as string | undefined;
const ALLOW_HTTP = import.meta.env.VITE_ATPROTO_ALLOW_HTTP === 'true';
const CLIENT_ID_ENV = import.meta.env.VITE_ATPROTO_CLIENT_ID as string | undefined;

const TIMELINE_COLLECTION = 'com.knightlab.timeline';

// ── Reactive session state ───────────────────────────────────────────────────

export type AuthState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'signed-in'; session: OAuthSession; agent: Agent; handle: string; avatar?: string }
  | { status: 'error'; error: string };

let _state = $state<AuthState>({ status: 'idle' });
export function getAuthState() { return _state; }

let _availableCollections = $state<CollectionDef[]>([]);
export function getAvailableCollections() { return _availableCollections; }

// ── Client singleton ─────────────────────────────────────────────────────────

function buildWriteLoopbackClientId(location: Location): string {
  const host = location.hostname === 'localhost' ? '127.0.0.1' : location.hostname;
  const port = location.port ? `:${location.port}` : '';
  const redirectUri = `http://${host}${port}/`;
  return `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('atproto repo:com.knightlab.timeline blob:*/*')}`;
}

let _client: BrowserOAuthClient | null = null;

async function client(): Promise<BrowserOAuthClient> {
  if (_client) return _client;

  _client = await BrowserOAuthClient.load({
    clientId: CLIENT_ID_ENV ?? buildWriteLoopbackClientId(window.location),
    handleResolver: HANDLE_RESOLVER ?? 'https://bsky.social',
    plcDirectoryUrl: PLC_URL,
    allowHttp: ALLOW_HTTP,
    onDelete() {
      _state = { status: 'idle' };
    },
  });

  return _client;
}

function _applySession(session: OAuthSession) {
  const agent = new Agent(session);
  _state = { status: 'signed-in', session, agent, handle: session.sub };

  void _resolveProfile(session, agent);
  void _detectCollections(agent);
}

async function _detectCollections(agent: Agent): Promise<void> {
  const results = await Promise.allSettled(
    collections.map(def =>
      agent.com.atproto.repo.listRecords({ repo: agent.assertDid, collection: def.nsid, limit: 1 })
    )
  );
  _availableCollections = collections.filter((_, i) => {
    const r = results[i];
    return r.status === 'fulfilled' && r.value.data.records.length > 0;
  });
}

async function _resolveProfile(session: OAuthSession, agent: Agent): Promise<void> {
  try {
    const [repoResp, profileResp] = await Promise.allSettled([
      agent.com.atproto.repo.describeRepo({ repo: session.sub }),
      agent.com.atproto.repo.getRecord({ repo: session.sub, collection: 'app.bsky.actor.profile', rkey: 'self' }),
    ]);

    if (_state.status !== 'signed-in' || _state.session !== session) return;

    const handle = repoResp.status === 'fulfilled' ? repoResp.value.data.handle : _state.handle;

    let avatar: string | undefined;
    if (profileResp.status === 'fulfilled') {
      // getRecord decodes blob refs into BlobRef instances (ref becomes a CID object, not { $link }) — see uploadBlob() below
      const rec = profileResp.value.data.value as { avatar?: { ref?: { toString(): string } } };
      const cid = rec.avatar?.ref?.toString();
      if (cid) {
        const base = session.server.issuer.replace(/\/$/, '');
        avatar = `${base}/xrpc/com.atproto.sync.getBlob?did=${session.sub}&cid=${encodeURIComponent(cid)}`;
      }
    }

    _state = { ..._state, handle, avatar };
  } catch {
    // profile resolution is best-effort
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function clearAuthError(): void {
  if (_state.status === 'error') _state = { status: 'idle' };
}

export async function initAuth(): Promise<void> {
  _state = { status: 'loading' };
  try {
    const c = await client();
    const result = await c.init();
    if (result) {
      _applySession(result.session);
    } else {
      _state = { status: 'idle' };
    }
  } catch (err) {
    _state = { status: 'error', error: String(err) };
  }
}

export async function signIn(handle: string, restoreView: 'home' | 'editor' = 'editor'): Promise<void> {
  _state = { status: 'loading' };
  try {
    const c = await client();
    // OAuth navigates away and back; remember which screen to land on so
    // signing in from Home doesn't drop the user into the editor.
    sessionStorage.setItem('tl-post-auth-restore', '1');
    sessionStorage.setItem('tl-post-auth-view', restoreView);
    await c.signIn(handle);
    // Browser navigates away; nothing more to do here.
  } catch (err) {
    sessionStorage.removeItem('tl-post-auth-restore');
    sessionStorage.removeItem('tl-post-auth-view');
    _state = { status: 'error', error: String(err) };
  }
}

export async function signOut(): Promise<void> {
  if (_state.status !== 'signed-in') return;
  const { session } = _state;
  _state = { status: 'idle' };
  _availableCollections = [];
  try {
    const c = await client();
    await c.revoke(session.sub);
  } catch {
    // Already signed out locally; ignore network errors.
  }
}

// ── PDS persistence ──────────────────────────────────────────────────────────

function generateRkey(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function rkeyFromUri(uri: string): string {
  return uri.split('/').at(-1) ?? generateRkey();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').trim();
}

export type SaveResult =
  | { ok: true; uri: string }
  | { ok: false; error: string };

export async function uploadBlob(file: Blob): Promise<ATProtoBlobRef> {
  if (_state.status !== 'signed-in') throw new Error('Not signed in.');
  const { agent } = _state;
  const buf = await file.arrayBuffer();
  const resp = await agent.com.atproto.repo.uploadBlob(new Uint8Array(buf), { encoding: file.type });
  const blob = resp.data.blob;
  // blob.ref is a CID class instance, not a plain { $link } object — convert explicitly
  return {
    $type: 'blob',
    ref: { $link: blob.ref.toString() },
    mimeType: blob.mimeType,
    size: blob.size,
  };
}

/** Construct the CDN URL for a blob stored on this user's PDS. */
export function blobUrl(cid: string): string {
  if (_state.status !== 'signed-in' || !cid) return '';
  const base = _state.session.server.issuer.replace(/\/$/, '');
  return `${base}/xrpc/com.atproto.sync.getBlob?did=${_state.session.sub}&cid=${encodeURIComponent(cid)}`;
}

export { cacheLocalBlobUrl, getCachedBlobUrl } from './blobCache.ts';
import { getCachedBlobUrl } from './blobCache.ts';

export function localOrPdsBlobUrl(cid: string): string {
  return getCachedBlobUrl(cid) ?? blobUrl(cid);
}

// getRecord responses do IPLD JSON decoding: blobRef.ref comes back as a CID
// class object, not the plain { $link: string } we write on upload. Handle both.
export function extractCid(ref: { $link: string } | unknown): string {
  if (!ref) return '';
  if (typeof ref === 'object' && '$link' in (ref as object)) return (ref as { $link: string }).$link ?? '';
  return String(ref);
}

function hydrateBlobRefs(events: TLEvent[], base: string, did: string): TLEvent[] {
  return events.map(ev => {
    const cidUrl = (cid: string) => cid ? `${base}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${encodeURIComponent(cid)}` : '';
    return {
      ...ev,
      ...(ev.media?.blobRef ? { media: { ...ev.media, url: cidUrl(extractCid(ev.media.blobRef.ref)), mimeType: ev.media.blobRef.mimeType } } : {}),
      ...(ev.background?.blobRef ? { background: { ...ev.background, url: cidUrl(extractCid(ev.background.blobRef.ref)) } } : {}),
    };
  });
}

function stripBlobUrls(events: TLEvent[]): TLEvent[] {
  return events.map(ev => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const media = ev.media?.blobRef ? (({ url: _u, mimeType: _m, ...rest }) => rest)(ev.media) : ev.media;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const background = ev.background?.blobRef ? (({ url: _u, ...rest }) => rest)(ev.background) : ev.background;
    return { ...ev, ...(media !== ev.media ? { media } : {}), ...(background !== ev.background ? { background } : {}) };
  });
}

function hydrateOgImage(settings: TLSettings | undefined, base: string, did: string): TLSettings | undefined {
  const blobRef = settings?.ogImage?.blobRef;
  if (!blobRef) return settings;
  const cid = extractCid(blobRef.ref);
  if (!cid) return settings;
  return {
    ...settings,
    ogImage: { ...settings.ogImage, url: `${base}/xrpc/com.atproto.sync.getBlob?did=${did}&cid=${encodeURIComponent(cid)}` },
  };
}

function stripOgImageUrl(settings: TLSettings | undefined): TLSettings | undefined {
  if (!settings?.ogImage?.blobRef || !settings.ogImage.url) return settings;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { url: _u, ...ogImage } = settings.ogImage;
  return { ...settings, ogImage };
}

export async function saveTimeline(timeline: TLTimeline, meta: { title?: string }, existingUri?: string): Promise<SaveResult> {
  if (_state.status !== 'signed-in') {
    return { ok: false, error: 'Not signed in.' };
  }
  const { agent } = _state;
  const rkey = existingUri ? rkeyFromUri(existingUri) : generateRkey();

  try {
    const cleanTimeline: TLTimeline = {
      ...timeline,
      events: stripBlobUrls(timeline.events),
      ...(timeline.title ? { title: stripBlobUrls([timeline.title])[0] } : {}),
      ...(timeline.settings ? { settings: stripOgImageUrl(timeline.settings) } : {}),
    };
    const resp = await agent.com.atproto.repo.putRecord({
      repo: agent.assertDid,
      collection: TIMELINE_COLLECTION,
      rkey,
      record: {
        $type: TIMELINE_COLLECTION,
        ...(meta.title ? { title: meta.title } : {}),
        timeline: cleanTimeline,
        createdAt: new Date().toISOString(),
      },
    });
    return { ok: true, uri: resp.data.uri };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Repo browser ─────────────────────────────────────────────────────────────

export type CollectionMediaItem = {
  uri: string;
  nsid: string;
  media: TLMedia;
  label?: string;
  prefill?: { caption?: string; credit?: string };
  webUrl?: string;
};

export async function getCollectionItem(uri: string): Promise<CollectionMediaItem | null> {
  if (_state.status !== 'signed-in') return null;
  const parts = uri.split('/');
  const repo = parts[2];
  const nsid = parts[3];
  const rkey = parts[4];
  if (!repo || !nsid || !rkey) return null;
  const def = collections.find(c => c.nsid === nsid);
  if (!def) return null;
  const { agent } = _state;
  const handle = _state.handle;
  try {
    const resp = await agent.com.atproto.repo.getRecord({ repo, collection: nsid, rkey });
    const media = def.extractMedia(resp.data.value);
    if (!media) return null;
    return {
      uri,
      nsid,
      media,
      label: def.extractLabel?.(resp.data.value) ?? undefined,
      prefill: def.extractPrefill?.(resp.data.value) ?? undefined,
      webUrl: def.webUrl?.(uri, handle) ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function listCollectionMedia(
  nsid: string,
  cursor?: string,
): Promise<{ items: CollectionMediaItem[]; cursor?: string }> {
  if (_state.status !== 'signed-in') return { items: [] };
  const def = collections.find(c => c.nsid === nsid);
  if (!def) return { items: [] };
  const { agent } = _state;
  const handle = _state.handle;
  const resp = await agent.com.atproto.repo.listRecords({
    repo: agent.assertDid,
    collection: nsid,
    limit: 24,
    cursor,
  });
  const items = resp.data.records.flatMap(r => {
    const media = def.extractMedia(r.value);
    if (!media) return [];
    const uri = r.uri as string;
    const label = def.extractLabel?.(r.value) ?? undefined;
    const prefill = def.extractPrefill?.(r.value) ?? undefined;
    const webUrl = def.webUrl?.(uri, handle) ?? undefined;
    return [{ uri, nsid, media, label, prefill, webUrl }];
  });
  return { items, cursor: resp.data.cursor };
}

export type TimelineListItem = {
  uri: string;
  title: string;
  createdAt: string;
};

export async function listTimelines(): Promise<TimelineListItem[]> {
  if (_state.status !== 'signed-in') return [];
  const { agent } = _state;
  try {
    const resp = await agent.com.atproto.repo.listRecords({
      repo: agent.assertDid,
      collection: TIMELINE_COLLECTION,
      limit: 50,
    });
    return resp.data.records.map(r => {
      const val = r.value as { title?: string; timeline?: { title?: { text?: { headline?: string } } }; createdAt?: string };
      const title = val.title
        || stripHtml(val.timeline?.title?.text?.headline ?? '')
        || 'Untitled';
      return { uri: r.uri, title, createdAt: val.createdAt ?? '' };
    });
  } catch {
    return [];
  }
}

export async function deleteTimeline(uri: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (_state.status !== 'signed-in') return { ok: false, error: 'Not signed in.' };
  const { agent } = _state;
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return { ok: false, error: 'Invalid URI' };
  const [, repo, collection, rkey] = m;
  try {
    await agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function getTimeline(uri: string): Promise<{ title?: string; timeline: TLTimeline } | null> {
  if (_state.status !== 'signed-in') return null;
  const { agent } = _state;
  const m = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const [, repo, collection, rkey] = m;
  try {
    const resp = await agent.com.atproto.repo.getRecord({ repo, collection, rkey });
    const val = resp.data.value as { title?: string; timeline?: TLTimeline };
    const tl = val.timeline;
    if (!tl) return null;
    const base = _state.session.server.issuer.replace(/\/$/, '');
    const did = _state.session.sub;
    return {
      ...(val.title ? { title: val.title } : {}),
      timeline: {
        ...tl,
        events: hydrateBlobRefs(tl.events, base, did),
        ...(tl.title ? { title: hydrateBlobRefs([tl.title], base, did)[0] } : {}),
        ...(tl.settings ? { settings: hydrateOgImage(tl.settings, base, did) } : {}),
      },
    };
  } catch {
    return null;
  }
}
