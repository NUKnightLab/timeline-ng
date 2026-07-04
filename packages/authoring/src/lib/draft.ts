import type { TLEvent, TLSettings } from '@knight-lab/timeline-ng-core';

const KEY = 'tl-draft-v1';

export interface Draft {
  title?: string;
  titleEvent: TLEvent | null;
  events: TLEvent[];
  atUri?: string;
  pdsClean?: boolean;
  settings?: TLSettings;
}

function stripBlobUrl(ev: TLEvent): TLEvent {
  if (!ev.media?.blobRef) return ev;
  const { url: _url, mimeType: _mt, ...rest } = ev.media;
  return { ...ev, media: rest };
}

export function saveDraft(draft: Draft): void {
  try {
    const clean: Draft = {
      ...draft,
      events: draft.events.map(stripBlobUrl),
      titleEvent: draft.titleEvent ? stripBlobUrl(draft.titleEvent) : null,
    };
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch { /* storage full */ }
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  localStorage.removeItem(KEY);
}
