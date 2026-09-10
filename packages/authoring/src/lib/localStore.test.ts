/**
 * @vitest-environment happy-dom
 *
 * The store that replaced a single localStorage slot. The behaviour worth
 * pinning is not that it writes — it is that nothing silently loses a draft:
 * the index tolerates being wrong, and the legacy key survives an upgrade.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEGACY_DRAFT_KEY, dbNameFor, forgetDraft, listDrafts, newDocId, noteDraft, persistDoc,
} from './localStore.ts';
import { migrateLegacyDraft } from './draftMigration.ts';
import { TimelineDoc } from './doc.svelte.ts';

beforeEach(() => localStorage.clear());

describe('the index', () => {
  it('lists nothing when empty', () => {
    expect(listDrafts()).toEqual([]);
  });

  it('lists most recently edited first', () => {
    noteDraft({ id: 'a', title: 'Older', savedAt: '2026-01-01T00:00:00.000Z' });
    noteDraft({ id: 'b', title: 'Newer', savedAt: '2026-06-01T00:00:00.000Z' });
    expect(listDrafts().map((d) => d.title)).toEqual(['Newer', 'Older']);
  });

  it('updates an entry rather than duplicating it', () => {
    noteDraft({ id: 'a', title: 'First name', savedAt: '2026-01-01T00:00:00.000Z' });
    noteDraft({ id: 'a', title: 'Renamed', savedAt: '2026-02-01T00:00:00.000Z' });
    expect(listDrafts()).toHaveLength(1);
    expect(listDrafts()[0].title).toBe('Renamed');
  });

  it('survives a corrupt index rather than throwing', () => {
    // The index is derived data; the documents are the real thing. Losing it
    // must degrade to an empty list, never to an unusable app.
    localStorage.setItem('tl-drafts-v1', 'not json at all');
    expect(listDrafts()).toEqual([]);
    noteDraft({ id: 'a', title: 'Recovered' });
    expect(listDrafts().map((d) => d.id)).toEqual(['a']);
  });

  it('ignores entries that are not drafts', () => {
    localStorage.setItem('tl-drafts-v1', JSON.stringify([{ nope: true }, { id: 'ok', title: 'x', savedAt: 'z' }]));
    expect(listDrafts().map((d) => d.id)).toEqual(['ok']);
  });

  it('keeps atUri only when there is one', () => {
    noteDraft({ id: 'a', title: 'Unpublished' });
    expect(listDrafts()[0]).not.toHaveProperty('atUri');
    noteDraft({ id: 'b', title: 'Published', atUri: 'at://did:plc:x/c/1' });
    expect(listDrafts().find((d) => d.id === 'b')?.atUri).toBe('at://did:plc:x/c/1');
  });
});

describe('documents round-trip through IndexedDB', () => {
  it('restores what was stored', async () => {
    const id = newDocId();
    const a = new TimelineDoc();
    const pa = (await persistDoc(id, a.doc)).provider!;
    a.load({ events: [{ unique_id: 'moon', text: { headline: 'The Moon Landing' } }], settings: {} });
    await pa.destroy();

    const b = new TimelineDoc();
    const pb = (await persistDoc(id, b.doc)).provider!;
    expect(b.events.map((e) => e.unique_id)).toEqual(['moon']);
    await pb.destroy();
  });

  it('keeps separate drafts separate', async () => {
    const [one, two] = [newDocId(), newDocId()];
    for (const [id, headline] of [[one, 'First'], [two, 'Second']] as const) {
      const d = new TimelineDoc();
      const p = (await persistDoc(id, d.doc)).provider!;
      d.load({ events: [{ unique_id: 's', text: { headline } }], settings: {} });
      await p.destroy();
    }
    const back = new TimelineDoc();
    const p = (await persistDoc(one, back.doc)).provider!;
    expect(back.events[0].text?.headline).toBe('First');
    await p.destroy();
  });

  it('forgetting a draft removes it from the list', async () => {
    const id = newDocId();
    noteDraft({ id, title: 'Doomed' });
    await forgetDraft(id);
    expect(listDrafts()).toEqual([]);
  });
});

describe('the legacy single draft', () => {
  const legacy = {
    title: 'Apollo',
    titleEvent: null,
    events: [{ unique_id: 'moon', text: { headline: 'The Moon Landing' } }],
    savedAt: '2026-03-01T00:00:00.000Z',
  };

  it('is carried across, not discarded', async () => {
    localStorage.setItem(LEGACY_DRAFT_KEY, JSON.stringify(legacy));
    const id = await migrateLegacyDraft();
    expect(id).not.toBeNull();

    expect(listDrafts().map((d) => d.title)).toEqual(['Apollo']);
    expect(listDrafts()[0].savedAt).toBe('2026-03-01T00:00:00.000Z');
    expect(localStorage.getItem(LEGACY_DRAFT_KEY)).toBeNull();

    const restored = new TimelineDoc();
    const p = (await persistDoc(id!, restored.doc)).provider!;
    expect(restored.events[0].unique_id).toBe('moon');
    expect(restored.title).toBe('Apollo');
    await p.destroy();
  });

  it('does nothing when there is no legacy draft', async () => {
    expect(await migrateLegacyDraft()).toBeNull();
    expect(listDrafts()).toEqual([]);
  });

  it('discards an empty legacy draft without creating one', async () => {
    localStorage.setItem(LEGACY_DRAFT_KEY, JSON.stringify({ ...legacy, events: [], titleEvent: null }));
    expect(await migrateLegacyDraft()).toBeNull();
    expect(listDrafts()).toEqual([]);
    expect(localStorage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
  });

  it('names the database after the draft id', () => {
    expect(dbNameFor('abc')).toBe('tl-doc-abc');
  });
});

describe('when the browser will not store anything', () => {
  // Private windows, blocked storage, an exhausted quota. The editor has to
  // survive all of them — losing local persistence is a warning, not a crash.
  it('reports unavailability instead of throwing', async () => {
    const real = globalThis.indexedDB;
    // @ts-expect-error — deliberately removing a global to simulate the browser
    delete globalThis.indexedDB;
    try {
      const result = await persistDoc('any-id', new TimelineDoc().doc);
      expect(result.provider).toBeNull();
      expect(result.error).toBeTruthy();
    } finally {
      globalThis.indexedDB = real;
    }
  });

  it('refuses to drop the legacy draft it cannot store', async () => {
    // The dangerous case: removing tl-draft-v1 after failing to write the
    // document would destroy the only copy of someone's unsaved work.
    localStorage.setItem(LEGACY_DRAFT_KEY, JSON.stringify({
      title: 'Apollo', titleEvent: null,
      events: [{ unique_id: 'moon', text: { headline: 'The Moon Landing' } }],
    }));
    const real = globalThis.indexedDB;
    // @ts-expect-error — see above
    delete globalThis.indexedDB;
    try {
      await expect(migrateLegacyDraft()).rejects.toThrow(/cannot migrate/);
      expect(localStorage.getItem(LEGACY_DRAFT_KEY)).not.toBeNull();
    } finally {
      globalThis.indexedDB = real;
    }
  });
});

describe('whether a draft matches what was published', () => {
  it('survives being closed and reopened', async () => {
    // A draft now outlives the page that made it, so "does this still match the
    // PDS copy?" has to be stored with it. Held on the bridge, this answer was
    // lost on reload and every reopened draft looked unsaved.
    const id = newDocId();
    const a = new TimelineDoc();
    const pa = (await persistDoc(id, a.doc)).provider!;
    a.load({ events: [{ unique_id: 'moon', text: { headline: 'Moon' } }], settings: {} },
      { atUri: 'at://did:plc:x/c/1' });
    expect(a.clean).toBe(true);
    await pa.destroy();

    const b = new TimelineDoc();
    const pb = (await persistDoc(id, b.doc)).provider!;
    expect(b.clean).toBe(true);
    expect(b.atUri).toBe('at://did:plc:x/c/1');
    await pb.destroy();
  });

  it('reports dirty after an edit made in a later session', async () => {
    const id = newDocId();
    const a = new TimelineDoc();
    const pa = (await persistDoc(id, a.doc)).provider!;
    a.load({ events: [{ unique_id: 'moon' }], settings: {} });
    await pa.destroy();

    const b = new TimelineDoc();
    const pb = (await persistDoc(id, b.doc)).provider!;
    b.addEvent({ unique_id: 'sputnik' });
    expect(b.clean).toBe(false);
    await pb.destroy();
  });
});
