import type { ATProtoBlobRef, TLMedia } from '@knight-lab/timeline-ng-core';

/** A record as returned by listRecords, narrowed to what context building needs. */
export type RecordRow = { uri: string; value: unknown };

/**
 * Per-media-URI text pulled from *other* records that describe it. Grain is the
 * motivating case: a `social.grain.photo` carries only a blob and alt text, and
 * everything a person would search for (title, description) lives on the
 * `social.grain.gallery` that a `social.grain.gallery.item` joins it to.
 */
export type ContextIndex = Map<string, { text: string; label?: string }>;

export type CollectionDef = {
  nsid: string;
  label: string;
  appUrl: string;
  description: string;
  mediaKind: 'image' | 'audio';
  extractMedia(record: unknown): TLMedia | null;
  extractLabel?(record: unknown): string | null;
  extractPrefill?(record: unknown): { caption?: string; credit?: string } | null;
  webUrl?(atUri: string, handle: string): string | null;
  /**
   * Sibling collections to enumerate alongside the media collection so
   * `buildContext` can join them. Enumerating these is best-effort: a failure
   * costs searchable text, not the media listing.
   */
  contextCollections?: string[];
  /** Join the enumerated sibling records into per-media-URI context. */
  buildContext?(records: Record<string, RecordRow[]>): ContextIndex;
};

function rkeyOf(atUri: string): string {
  return atUri.split('/').at(-1) ?? '';
}

function toBlobRef(b: unknown): ATProtoBlobRef | null {
  if (!b || typeof b !== 'object') return null;
  const blob = b as Record<string, unknown>;
  const mimeType = typeof blob.mimeType === 'string' ? blob.mimeType : 'application/octet-stream';
  const size = typeof blob.size === 'number' ? blob.size : 0;
  let link = '';
  if (blob.ref && typeof blob.ref === 'object') {
    const ref = blob.ref as Record<string, unknown>;
    link = typeof ref.$link === 'string' ? ref.$link : String(blob.ref);
  }
  if (!link) return null;
  return { $type: 'blob', ref: { $link: link }, mimeType, size };
}

// ── Search text harvesting ──────────────────────────────────────────────────
//
// The repo browser filters client-side across everything a record says about
// itself, so rather than asking each CollectionDef to nominate fields we walk
// the record and collect every human-meaningful string. That way a new app's
// records are filterable the moment its media extractor lands.

// Structural/identifier keys whose values are never worth matching against.
const NON_TEXT_KEYS = new Set([
  '$type', '$link', 'ref', 'cid', 'did', 'mimeType', 'size', 'encoding',
  'aspectRatio', 'width', 'height', 'rev', 'sig', 'blob',
]);

const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/;

const MAX_HARVEST_DEPTH = 6;
const MAX_STRING_LEN = 500;
const MAX_TEXT_LEN = 2000;

function harvest(value: unknown, depth: number, out: string[]): void {
  if (depth > MAX_HARVEST_DEPTH) return;
  if (typeof value === 'string') {
    if (!value) return;
    // at:// and did: values are plumbing, not something anyone types to search.
    if (value.startsWith('at://') || value.startsWith('did:')) return;
    // Keep the calendar date from timestamps so "2019" matches; drop the clock.
    const iso = ISO_DATETIME.exec(value);
    out.push(iso ? iso[1] : value.slice(0, MAX_STRING_LEN));
    return;
  }
  if (typeof value === 'number') {
    // Only plausible years — other bare numbers are noise (sizes, dimensions).
    if (Number.isInteger(value) && value >= 1000 && value <= 9999) out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) harvest(v, depth + 1, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (NON_TEXT_KEYS.has(k)) continue;
      harvest(v, depth + 1, out);
    }
  }
}

/**
 * Flatten every human-meaningful string in a record into one lowercase blob
 * for substring filtering. Duplicates are dropped so repeated values (a title
 * echoed in an alt text, say) don't crowd out the length budget.
 */
export function harvestSearchText(record: unknown, ...extra: (string | undefined)[]): string {
  const out: string[] = [];
  harvest(record, 0, out);
  for (const e of extra) if (e) out.push(e);
  return finalizeSearchText(out);
}

/**
 * Fold late-arriving context (see {@link ContextIndex}) into an already-built
 * search blob, keeping the same dedup and length rules.
 */
export function mergeSearchText(existing: string, ...extra: (string | undefined)[]): string {
  return finalizeSearchText([existing, ...extra.filter((e): e is string => !!e)]);
}

function finalizeSearchText(raws: (string | undefined)[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    const s = raw.trim().toLowerCase();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    parts.push(s);
  }
  return parts.join(' ').slice(0, MAX_TEXT_LEN);
}

const GRAIN_GALLERY = 'social.grain.gallery';
const GRAIN_GALLERY_ITEM = 'social.grain.gallery.item';

export const collections: CollectionDef[] = [
  {
    nsid: 'is.currents.feed.save',
    label: 'Currents.is',
    appUrl: 'https://currents.is',
    description: 'Image saves from your Currents.is collections.',
    mediaKind: 'image',
    extractMedia(record) {
      const r = record as { content?: { $type?: string; image?: unknown; alt?: string } };
      if (r.content?.$type !== 'is.currents.content.image') return null;
      const blobRef = toBlobRef(r.content.image);
      if (!blobRef) return null;
      return { blobRef, ...(r.content.alt ? { alt: r.content.alt } : {}) };
    },
    extractLabel(record) {
      const r = record as { originUrl?: string };
      if (r.originUrl) {
        try { return new URL(r.originUrl).hostname.replace(/^www\./, ''); } catch { /* fall through */ }
      }
      return null;
    },
    extractPrefill(record) {
      const r = record as {
        text?: string;
        content?: { attribution?: { name?: string } };
      };
      const caption = r.text?.trim();
      const credit = r.content?.attribution?.name?.trim();
      if (!caption && !credit) return null;
      return { ...(caption ? { caption } : {}), ...(credit ? { credit } : {}) };
    },
    webUrl(atUri, handle) {
      return `https://currents.is/profile/${handle}/save/${rkeyOf(atUri)}`;
    },
  },
  {
    nsid: 'social.grain.photo',
    label: 'Grain.social',
    appUrl: 'https://grain.social',
    description: 'Photos from your Grain.social collection.',
    mediaKind: 'image',
    extractMedia(record) {
      const r = record as { photo?: unknown; alt?: string };
      const blobRef = toBlobRef(r.photo);
      if (!blobRef) return null;
      return { blobRef, ...(r.alt ? { alt: r.alt } : {}) };
    },
    extractLabel(record) {
      const r = record as { alt?: string };
      return r.alt?.trim() || null;
    },
    extractPrefill(record) {
      const r = record as { alt?: string };
      return r.alt?.trim() ? { caption: r.alt.trim() } : null;
    },
    webUrl(_atUri, _handle) {
      return null; // URL format not confirmed
    },
    // A photo record is just a blob plus optional alt text; the title and
    // description people would actually search for live on the gallery, joined
    // through gallery.item rows.
    contextCollections: [GRAIN_GALLERY, GRAIN_GALLERY_ITEM],
    buildContext(records) {
      const galleries = new Map<string, { title?: string; description?: string }>();
      for (const row of records[GRAIN_GALLERY] ?? []) {
        const v = row.value as { title?: string; description?: string };
        galleries.set(row.uri, { title: v.title?.trim(), description: v.description?.trim() });
      }

      const index: ContextIndex = new Map();
      for (const row of records[GRAIN_GALLERY_ITEM] ?? []) {
        const v = row.value as { item?: string; gallery?: string };
        if (!v.item || !v.gallery) continue;
        const gallery = galleries.get(v.gallery);
        if (!gallery) continue;
        const text = [gallery.title, gallery.description].filter(Boolean).join(' ');
        if (!text) continue;
        // A photo can appear in more than one gallery; keep all of their text
        // searchable but label it with the first one encountered.
        const prev = index.get(v.item);
        index.set(v.item, {
          text: prev ? `${prev.text} ${text}` : text,
          label: prev?.label ?? gallery.description ?? gallery.title,
        });
      }
      return index;
    },
  },
  {
    nsid: 'fm.plyr.track',
    label: 'Plyr.fm',
    appUrl: 'https://plyr.fm',
    description: 'Audio tracks you\'ve uploaded to Plyr.fm.',
    mediaKind: 'audio',
    extractMedia(record) {
      const r = record as { audioBlob?: unknown; audioUrl?: string };
      const blobRef = toBlobRef(r.audioBlob);
      if (blobRef) return { blobRef };
      if (r.audioUrl) return { url: r.audioUrl };
      return null;
    },
    extractLabel(record) {
      const r = record as { title?: string; artist?: string };
      if (r.title && r.artist) return `${r.title} — ${r.artist}`;
      return r.title?.trim() || r.artist?.trim() || null;
    },
    extractPrefill(record) {
      const r = record as { title?: string; artist?: string };
      const caption = r.title?.trim();
      const credit = r.artist?.trim();
      if (!caption && !credit) return null;
      return { ...(caption ? { caption } : {}), ...(credit ? { credit } : {}) };
    },
    webUrl(_atUri, _handle) {
      return null; // URL format not confirmed
    },
  },
];
