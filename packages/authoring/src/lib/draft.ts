import type { TLEvent, TLSettings } from '@knight-lab/timeline-ng-core';

const KEY = 'tl-draft-v1';

export interface Draft {
  title?: string;
  titleEvent: TLEvent | null;
  events: TLEvent[];
  atUri?: string;
  pdsClean?: boolean;
  settings?: TLSettings;
  /** ISO timestamp of the last saveDraft() call; stamped automatically, callers don't set it. */
  savedAt?: string;
}

function stripBlobUrl(ev: TLEvent): TLEvent {
  if (!ev.media?.blobRef) return ev;
  const { url: _url, mimeType: _mt, ...rest } = ev.media;
  return { ...ev, media: rest };
}

/**
 * Whether the browser copy of a timeline is still the only copy worth keeping.
 *
 * The rule used to be "clean means saved, so drop it", which held while
 * `pdsClean` was a flag that could not return to true without an explicit save.
 * It is now derived by comparing content (see `TimelineDoc.clean`) and reports
 * clean again when an edit is reversed — so on a timeline that was never
 * published, undoing back to where you started would have deleted the only
 * copy there was.
 *
 * A draft is disposable only when the same content exists on the PDS, which
 * means clean *and* published. Empty timelines have nothing to protect.
 */
export function draftIsWorthKeeping(
  { clean, atUri, hasContent }: { clean: boolean; atUri: string | null | undefined; hasContent: boolean },
): boolean {
  if (!hasContent) return false;
  return !(clean && !!atUri);
}

export function saveDraft(draft: Draft): void {
  try {
    const clean: Draft = {
      ...draft,
      events: draft.events.map(stripBlobUrl),
      titleEvent: draft.titleEvent ? stripBlobUrl(draft.titleEvent) : null,
      savedAt: new Date().toISOString(),
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
