/**
 * @vitest-environment happy-dom
 *
 * The whole of *Keep both* and its aftermath, end to end over real stored
 * documents: a fork is left behind in its own IndexedDB database, read back
 * out of it without being opened, worked through a row at a time, and deleted
 * once it has nothing left to give.
 *
 * `fake-indexeddb` implements the specification rather than the ways real
 * browsers depart from it, so this proves the mechanism and not the storage.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';
import { TimelineDoc } from './doc.svelte.ts';
import {
  forgetDraft,
  forgetDraftWithForks,
  listDrafts,
  newDocId,
  noteDraft,
  persistDoc,
  readDraftTimeline,
} from './localStore.ts';
import { applyPull, pullList } from './pullList.ts';

const moon: TLEvent = { unique_id: 'moon', start_date: { year: 1969 }, text: { headline: 'Apollo 11' } };
const voyager: TLEvent = { unique_id: 'voyager', start_date: { year: 1977 }, text: { headline: 'Voyager 1' } };
const tl = (events: TLEvent[]): TLTimeline => ({ events });

beforeEach(() => localStorage.clear());

/** A fork as *Keep both* leaves one: a stored draft carrying its ancestor. */
async function leaveFork(base: TLTimeline, edits: (doc: TimelineDoc) => void) {
  const id = newDocId();
  const doc = new TimelineDoc();
  const { provider } = await persistDoc(id, doc.doc);
  doc.load(base);
  edits(doc);
  noteDraft({
    id,
    title: 'Space race',
    clean: false,
    forkedFrom: { atUri: 'at://did:plc:x/com.knightlab.timeline/uxdemo', baseCid: 'bafbase', baseSnapshot: JSON.stringify(base) },
  });
  // Let IndexedDB settle before detaching: y-indexeddb stores updates in its
  // own transaction, and destroying the provider in the same tick can abort a
  // write that has not landed. The app never does this — it holds the provider
  // for as long as the draft is open.
  await new Promise((resolve) => setTimeout(resolve, 10));
  await provider?.destroy();
  doc.destroy();
  return id;
}

describe('a fork, after Keep both', () => {
  it('can be read back without being opened', async () => {
    const id = await leaveFork(tl([moon]), (doc) => doc.addEvent(voyager));

    const fork = await readDraftTimeline(id);
    expect(fork?.events.map((e) => e.unique_id).sort()).toEqual(['moon', 'voyager']);
  });

  it('reads as nothing when there is no such draft', async () => {
    expect(await readDraftTimeline(newDocId())).toBe(null);
  });

  it('is worked through one row at a time, and empties', async () => {
    // Two changes in the fork, and the working document is the published
    // version it diverged from.
    const base = tl([moon]);
    const id = await leaveFork(base, (doc) => {
      doc.addEvent(voyager);
      doc.replaceEvent(doc.entries[0].key, { ...moon, group: 'Missions' });
    });
    const fork = (await readDraftTimeline(id))!;

    const working = new TimelineDoc();
    working.load(base);

    let list = pullList(base, fork, working.toTimeline());
    expect(list.entries).toHaveLength(2);

    // One row brought over leaves exactly the other outstanding.
    applyPull(working, list.entries[0]);
    list = pullList(base, fork, working.toTimeline());
    expect(list.entries).toHaveLength(1);

    applyPull(working, list.entries[0]);
    list = pullList(base, fork, working.toTimeline());
    expect(list.entries).toEqual([]);

    // And everything the fork held is now in the working document.
    expect(working.events.map((e) => e.unique_id).sort()).toEqual(['moon', 'voyager']);
    expect(working.events.find((e) => e.unique_id === 'moon')?.group).toBe('Missions');
  });

  it('is deleted once it has nothing left to give, and stops being listed', async () => {
    const id = await leaveFork(tl([moon]), (doc) => doc.addEvent(voyager));
    expect(listDrafts().map((d) => d.id)).toContain(id);

    await forgetDraft(id);
    expect(listDrafts().map((d) => d.id)).not.toContain(id);
    expect(await readDraftTimeline(id)).toBe(null);
  });

  it('keeps its ancestor across routine index writes', async () => {
    // The pull-list is nothing without the base, and a fork outlives many
    // ordinary writes to the index before anyone comes back to it.
    const id = await leaveFork(tl([moon]), (doc) => doc.addEvent(voyager));
    noteDraft({ id, title: 'Space race', clean: false });

    expect(listDrafts().find((d) => d.id === id)?.forkedFrom?.baseSnapshot).toBe(JSON.stringify(tl([moon])));
  });
});

describe('deleting the timeline an unmerged draft came from', () => {
  const URI = 'at://did:plc:x/com.knightlab.timeline/uxdemo';

  /** A timeline that owns the record, and an unmerged draft of it. */
  async function pair() {
    const forkId = await leaveFork(tl([moon]), (doc) => doc.addEvent(voyager));
    const timelineId = newDocId();
    noteDraft({ id: timelineId, title: 'Space race', atUri: URI, clean: true });
    return { forkId, timelineId };
  }

  it('takes the unmerged draft with it', async () => {
    const { forkId, timelineId } = await pair();

    expect(await forgetDraftWithForks(timelineId)).toBe(1);
    expect(listDrafts().map((d) => d.id)).not.toContain(forkId);
    // And the document itself, not only the index entry: a database left
    // behind is storage nothing will ever read again.
    expect(await readDraftTimeline(forkId)).toBe(null);
  });

  it('leaves other timelines and their unmerged drafts alone', async () => {
    const { forkId } = await pair();
    const other = newDocId();
    noteDraft({ id: other, title: 'Something else', atUri: 'at://did:plc:x/com.knightlab.timeline/other' });

    await forgetDraftWithForks(other);
    expect(listDrafts().map((d) => d.id)).toContain(forkId);
  });

  it('deletes a batch on its own without touching the timeline', async () => {
    // Deleting an unmerged draft is still just deleting it — the cascade runs
    // one way only.
    const { forkId, timelineId } = await pair();

    expect(await forgetDraftWithForks(forkId)).toBe(0);
    expect(listDrafts().map((d) => d.id)).toContain(timelineId);
  });
});
