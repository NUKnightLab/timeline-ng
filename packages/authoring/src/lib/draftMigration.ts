/**
 * Carry the single localStorage draft into the per-document store.
 *
 * People have unsaved work under `tl-draft-v1` right now, and it is the only
 * copy of it — that key was written precisely when a timeline was *not* safe
 * anywhere else. Dropping it on upgrade would destroy exactly the drafts that
 * mattered most (phase1-plan.md [P6]).
 *
 * Runs once. The legacy key is removed only after the document has been
 * persisted and indexed, so an interrupted migration retries on the next load
 * rather than losing the draft in between.
 */
import type { TLTimeline } from '@knight-lab/timeline-ng-core';
import { loadDraft, clearDraft } from './draft.ts';
import { TimelineDoc } from './doc.svelte.ts';
import { newDocId, noteDraft, persistDoc } from './localStore.ts';

export async function migrateLegacyDraft(): Promise<string | null> {
  const draft = loadDraft();
  if (!draft) return null;

  const hasContent = draft.events.length > 0 || !!draft.titleEvent;
  if (!hasContent) {
    clearDraft();
    return null;
  }

  const id = newDocId();
  const doc = new TimelineDoc();
  const timeline: TLTimeline = {
    ...(draft.titleEvent ? { title: draft.titleEvent } : {}),
    events: draft.events,
    ...(draft.settings ? { settings: draft.settings } : {}),
  };
  doc.load(timeline, {
    title: draft.title,
    titleSetByUser: !!draft.title,
    atUri: draft.atUri,
  }, { clean: draft.pdsClean ?? false });

  const { provider, error } = await persistDoc(id, doc.doc);
  if (!provider) {
    // Leave the legacy key alone: without somewhere to put the draft, removing
    // it would destroy the only copy. Retry on the next load.
    doc.destroy();
    throw new Error(`cannot migrate draft: ${error}`);
  }
  noteDraft({
    id,
    title: doc.title,
    editedAt: draft.savedAt ?? new Date().toISOString(),
    atUri: draft.atUri,
  });
  await provider.destroy();
  doc.destroy();

  clearDraft();
  return id;
}
