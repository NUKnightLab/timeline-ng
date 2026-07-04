import type { ATProtoBlobRef, TLMedia } from '@knight-lab/timeline-ng-core';

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
