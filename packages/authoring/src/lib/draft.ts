/**
 * The single-slot draft this app used to keep in localStorage.
 *
 * Read-only now, and read exactly once: `draftMigration.ts` carries whatever is
 * here into the per-document store and then clears the key. Drafts live in
 * IndexedDB, one document each, and persist themselves — see `localStore.ts`.
 *
 * Kept rather than deleted because people have unsaved work under this key
 * right now, and it is the only copy of it. It can go once enough time has
 * passed that nobody is still carrying one.
 */
import type { TLEvent, TLSettings } from '@knight-lab/timeline-ng-core';

const KEY = 'tl-draft-v1';

export interface Draft {
  title?: string;
  titleEvent: TLEvent | null;
  events: TLEvent[];
  atUri?: string;
  pdsClean?: boolean;
  settings?: TLSettings;
  /** ISO timestamp of the last save, stamped when it was written. */
  savedAt?: string;
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
