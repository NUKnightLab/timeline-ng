/**
 * One row per timeline: the matching, the order, and the six states.
 *
 * These are what the merged list is *for* — a row that says where a timeline
 * lives instead of implying it from which list it sat in.
 */
import { describe, it, expect } from 'vitest';
import type { DraftSummary } from './localStore.ts';
import { orphanForks, ownerOf, timelineRows } from './timelineRows.ts';
import type { TimelineRecord } from './timelineRows.ts';

const URI = 'at://did:plc:alice/com.knightlab.timeline/space';
const OTHER = 'at://did:plc:alice/com.knightlab.timeline/moon';

const draft = (over: Partial<DraftSummary> = {}): DraftSummary => ({
  id: 'd1',
  title: 'Space race',
  editedAt: '2026-11-11T10:00:00.000Z',
  ...over,
});

const record = (over: Partial<TimelineRecord> = {}): TimelineRecord => ({
  uri: URI,
  cid: 'cid-1',
  title: 'Space race',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

describe('one row per timeline', () => {
  it('folds a draft and its record into a single row', () => {
    const rows = timelineRows([draft({ atUri: URI, baseCid: 'cid-1', clean: true })], [record()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: URI, title: 'Space race', state: 'published', published: true });
    expect(rows[0].draft?.id).toBe('d1');
    expect(rows[0].record?.cid).toBe('cid-1');
  });

  it('keeps its identity before its record arrives', () => {
    // The list draws from local drafts at once and folds records in when the
    // fetch returns; a row that changed key in between would be torn down
    // and rebuilt under the author's cursor.
    const d = draft({ atUri: URI, baseCid: 'cid-1', clean: true });
    expect(timelineRows([d], [])[0].key).toBe(timelineRows([d], [record()])[0].key);
  });

  it('lists a record this browser has never opened', () => {
    const rows = timelineRows([], [record({ title: 'Computing Women' })]);
    expect(rows[0]).toMatchObject({ state: 'published', published: true, draft: null });
  });

  it('orders by when each was last touched, from either source', () => {
    const rows = timelineRows(
      [draft({ id: 'local', title: 'Edited today', editedAt: '2026-11-11T10:00:00.000Z' })],
      [record({ uri: OTHER, title: 'Published last month', createdAt: '2026-10-01T00:00:00.000Z' })],
    );
    expect(rows.map((r) => r.title)).toEqual(['Edited today', 'Published last month']);
  });
});

describe('what a row says about where it stands', () => {
  it('never published, when it exists only here', () => {
    expect(timelineRows([draft()], [])[0]).toMatchObject({ state: 'unpublished', published: false });
  });

  it('unpublished changes, when the local copy has moved on', () => {
    const rows = timelineRows([draft({ atUri: URI, baseCid: 'cid-1', clean: false })], [record()]);
    expect(rows[0].state).toBe('changed');
  });

  it('behind, when another browser published since', () => {
    // The state the merged list buys: `listRecords` already returns the CID,
    // so this needs no extra request and no opening of the draft.
    const rows = timelineRows([draft({ atUri: URI, baseCid: 'cid-1', clean: true })], [record({ cid: 'cid-2' })]);
    expect(rows[0].state).toBe('behind');
  });

  it('prefers behind over unpublished changes', () => {
    // Both are true at once, and only one of them is news.
    const rows = timelineRows([draft({ atUri: URI, baseCid: 'cid-1', clean: false })], [record({ cid: 'cid-2' })]);
    expect(rows[0].state).toBe('behind');
  });

  it('says nothing about an entry written before base CIDs were recorded', () => {
    const rows = timelineRows([draft({ atUri: URI, clean: true })], [record({ cid: 'cid-2' })]);
    expect(rows[0].state).toBe('published');
  });

  it('gone, when a completed fetch says the record is not there', () => {
    expect(timelineRows([draft({ atUri: URI, clean: true })], [], true)[0]).toMatchObject({
      state: 'gone',
      published: false,
    });
  });

  it('does not call a published draft gone while signed out or still fetching', () => {
    // An empty record list means "not looked" until a signed-in fetch has
    // finished. Claimed as `gone`, every draft of a published timeline
    // announced that it had left the account whenever the page was opened
    // signed out.
    const d = draft({ atUri: URI, baseCid: 'cid-1', clean: true });
    expect(timelineRows([d], [], false)[0].state).toBe('published');
    expect(timelineRows([draft({ atUri: URI, clean: false })], [], false)[0].state).toBe('changed');
    // And once it has looked, the same draft reads honestly.
    expect(timelineRows([d], [], true)[0].state).toBe('gone');
  });

  it('does not call a draft gone merely because nothing has been fetched yet', () => {
    // Signed out, or mid-fetch: `records` is empty and that is not evidence.
    // This is the one state that would be a lie, so it is pinned here — a
    // draft that was never published reads as unpublished, not gone.
    expect(timelineRows([draft()], [])[0].state).toBe('unpublished');
  });
});

describe('unmerged drafts', () => {
  const fork = draft({
    id: 'fork',
    title: 'Space race',
    forkedFrom: { atUri: URI, baseCid: 'cid-1', baseSnapshot: '{}' },
  });

  it('nest under the timeline they came from, never as rows of their own', () => {
    const rows = timelineRows([draft({ atUri: URI, baseCid: 'cid-1', clean: true }), fork], [record()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].forks.map((f) => f.id)).toEqual(['fork']);
  });

  it('are found on their own when their timeline is gone from this browser', () => {
    expect(orphanForks([fork]).map((f) => f.id)).toEqual(['fork']);
    expect(orphanForks([draft({ atUri: URI }), fork])).toEqual([]);
  });
});

describe('a browser used for more than one account', () => {
  const ALICE = 'did:plc:alice';
  const BOB = 'did:plc:bob';
  const mine = draft({ atUri: URI, baseCid: 'cid-1', clean: true, ownerHandle: 'alice.test' });

  it('reads ownership off the record, not off the draft', () => {
    expect(ownerOf(URI)).toBe(ALICE);
    expect(ownerOf(undefined)).toBeNull();
    // A draft that has never been published belongs to nobody yet.
    expect(ownerOf('not-a-uri')).toBeNull();
  });

  it('says nothing about a record in an account it has not looked at', () => {
    // The bug this closes: signed in as Bob, every one of Alice's drafts
    // announced "no longer in your account" — Bob's record list does not
    // mention them, and the list read that as absence.
    const [row] = timelineRows([mine], [], true, BOB);
    expect(row.state).toBe('published');
    expect(row.otherAccount).toEqual({ did: ALICE, handle: 'alice.test' });
  });

  it('still lists it, rather than hiding work behind whoever is signed in', () => {
    expect(timelineRows([mine], [], true, BOB)).toHaveLength(1);
  });

  it('compares normally for the account that owns it', () => {
    const [row] = timelineRows([mine], [], true, ALICE);
    expect(row.state).toBe('gone');
    expect(row.otherAccount).toBeUndefined();
  });

  it('marks nothing while signed out, since there is no viewer to differ from', () => {
    const [row] = timelineRows([mine], [], false, null);
    expect(row.otherAccount).toBeUndefined();
    expect(row.state).toBe('published');
  });

  it('leaves a never-published draft unowned whoever is signed in', () => {
    const [row] = timelineRows([draft()], [], true, BOB);
    expect(row.otherAccount).toBeUndefined();
    expect(row.state).toBe('unpublished');
  });
});
