import { describe, it, expect } from 'vitest';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';
import { SETTINGS_ID, TITLE_ID, threeWay } from './threeWay.ts';

const moon: TLEvent = {
  unique_id: 'moon',
  start_date: { year: 1969 },
  text: { headline: 'The Moon Landing', text: '<p>One small step.</p>' },
};
const sputnik: TLEvent = {
  unique_id: 'sputnik',
  start_date: { year: 1957 },
  text: { headline: 'Sputnik 1' },
};

const tl = (events: TLEvent[], extra: Partial<TLTimeline> = {}): TLTimeline => ({ events, ...extra });
const edit = (ev: TLEvent, patch: Partial<TLEvent>): TLEvent => ({ ...ev, ...patch });

describe('threeWay', () => {
  it('attributes each change to the side that made it', () => {
    const base = tl([moon]);
    const mine = tl([edit(moon, { group: 'Missions' })]);
    const theirs = tl([moon, sputnik]);

    const r = threeWay(base, mine, theirs);
    expect(r.mine).toEqual([{ id: 'moon', kind: 'edited', fields: ['group'] }]);
    expect(r.theirs).toEqual([{ id: 'sputnik', kind: 'added' }]);
  });

  it('merges disjoint slides without asking', () => {
    // The whole point of [P9]: each side touched something the other did not,
    // so no field anywhere has two values and nobody needs to choose.
    const base = tl([moon]);
    const mine = tl([moon, { ...sputnik, unique_id: 'vostok' }]);
    const theirs = tl([moon, sputnik]);

    const r = threeWay(base, mine, theirs);
    expect(r.collisions).toEqual([]);
    expect(r.merged?.events.map((e) => e.unique_id).sort()).toEqual(['moon', 'sputnik', 'vostok']);
  });

  it('merges one slide that each side changed in a different field', () => {
    // Slide-level overlap is non-empty here and field-level overlap is empty,
    // which is exactly the case that must not produce a prompt.
    const base = tl([moon]);
    const mine = tl([edit(moon, { group: 'Missions' })]);
    const theirs = tl([edit(moon, { media_position: 'right' })]);

    const r = threeWay(base, mine, theirs);
    expect(r.collisions).toEqual([]);
    expect(r.merged?.events[0]).toMatchObject({ group: 'Missions', media_position: 'right' });
  });

  it('does not call an identical change on both sides a disagreement', () => {
    const base = tl([moon]);
    const same = tl([edit(moon, { group: 'Missions' })]);

    const r = threeWay(base, same, tl([edit(moon, { group: 'Missions' })]));
    expect(r.collisions).toEqual([]);
    expect(r.merged?.events[0].group).toBe('Missions');
    expect(same.events[0].group).toBe('Missions');
  });

  it('reports a field two sides set differently', () => {
    const base = tl([moon]);
    const mine = tl([edit(moon, { group: 'Missions' })]);
    const theirs = tl([edit(moon, { group: 'Apollo' })]);

    const r = threeWay(base, mine, theirs);
    expect(r.collisions).toEqual([{ id: 'moon', reason: 'fields', fields: ['group'] }]);
    expect(r.merged).toBe(null);
  });

  it('reports rich text edited on both sides', () => {
    // The limit that cannot be merged: the published side is HTML with no
    // history, so there is nothing to merge character by character through.
    const base = tl([moon]);
    const mine = tl([edit(moon, { text: { headline: 'The moon landing', text: '<p>One small step.</p>' } })]);
    const theirs = tl([edit(moon, { text: { headline: 'The Moon Landing, 1969', text: '<p>One small step.</p>' } })]);

    const r = threeWay(base, mine, theirs);
    expect(r.collisions).toEqual([{ id: 'moon', reason: 'fields', fields: ['text'] }]);
  });

  it('reports a slide one side removed and the other edited', () => {
    const base = tl([moon, sputnik]);
    const mine = tl([moon]);
    const theirs = tl([moon, edit(sputnik, { group: 'Space race' })]);

    const r = threeWay(base, mine, theirs);
    expect(r.collisions).toEqual([{ id: 'sputnik', reason: 'removed-vs-edited' }]);
  });

  it('carries a removal through when only one side removed', () => {
    const base = tl([moon, sputnik]);
    const mine = tl([moon]);

    const r = threeWay(base, mine, tl([moon, sputnik]));
    expect(r.collisions).toEqual([]);
    expect(r.merged?.events.map((e) => e.unique_id)).toEqual(['moon']);
  });

  it('carries a cleared field through rather than restoring it from the base', () => {
    const base = tl([edit(moon, { group: 'Missions' })]);
    const mine = tl([moon]);
    const theirs = tl([edit(moon, { group: 'Missions', media_position: 'right' })]);

    const r = threeWay(base, mine, theirs);
    expect(r.collisions).toEqual([]);
    expect(r.merged?.events[0]).not.toHaveProperty('group');
    expect(r.merged?.events[0].media_position).toBe('right');
  });

  it('treats the title slide as a slide', () => {
    const base = tl([moon], { title: { text: { headline: 'Spaceflight' } } });
    const mine = tl([moon], { title: { text: { headline: 'Spaceflight' } } });
    const theirs = tl([moon], { title: { text: { headline: 'A history of spaceflight' } } });

    const r = threeWay(base, mine, theirs);
    expect(r.theirs).toEqual([{ id: TITLE_ID, kind: 'edited', fields: ['text'] }]);
    expect(r.merged?.title?.text?.headline).toBe('A history of spaceflight');
  });

  it('merges settings as one value, and reports a real disagreement about them', () => {
    const base = tl([moon], { settings: { theme: 'light' } });
    const mine = tl([moon], { settings: { theme: 'dark' } });

    expect(threeWay(base, mine, tl([moon], { settings: { theme: 'light' } })).collisions).toEqual([]);

    const r = threeWay(base, mine, tl([moon], { settings: { theme: 'auto' } }));
    expect(r.collisions).toEqual([{ id: SETTINGS_ID, reason: 'fields' }]);
    expect(r.mine).toContainEqual({ id: SETTINGS_ID, kind: 'edited' });
  });

  it('will not merge when a slide cannot be matched across versions', () => {
    // No `unique_id`, no way to tell "the same slide, edited" from "a new
    // slide" — a merge would either duplicate it or drop it.
    const unkeyed = { start_date: { year: 1961 }, text: { headline: 'Vostok 1' } } as TLEvent;
    const r = threeWay(tl([moon]), tl([moon, unkeyed]), tl([moon, sputnik]));
    expect(r.merged).toBe(null);
  });

  it('reports a slide both sides added differently under one id', () => {
    const r = threeWay(tl([]), tl([moon]), tl([edit(moon, { group: 'Apollo' })]));
    expect(r.collisions).toEqual([{ id: 'moon', reason: 'fields', fields: ['group'] }]);
  });
});

describe('URLs derived from blob references', () => {
  const blobRef = { $type: 'blob' as const, ref: { $link: 'bafkreiposter' }, mimeType: 'image/png', size: 100 };
  const withUrl: TLEvent = {
    unique_id: 'moon',
    start_date: { year: 1969 },
    text: { headline: 'The Moon Landing' },
    media: { blobRef, url: 'https://pds.example/xrpc/com.atproto.sync.getBlob?did=did:plc:x&cid=bafkreiposter' },
  };
  const withoutUrl: TLEvent = { ...withUrl, media: { blobRef } };

  it('are not a change', () => {
    // The URL is recomputed from the CID and the PDS origin on every read, so
    // one side carrying it and the other not is not a disagreement about
    // anything.
    const r = threeWay(tl([withoutUrl]), tl([withUrl]), tl([withoutUrl]));
    expect(r.mine).toEqual([]);
    expect(r.collisions).toEqual([]);
  });

  it('are not a change in settings either', () => {
    const base = tl([moon], { settings: { ogImage: { blobRef } } });
    const mine = tl([moon], { settings: { ogImage: { blobRef, url: 'https://pds.example/blob' } } });

    const r = threeWay(base, mine, tl([moon], { settings: { ogImage: { blobRef } } }));
    expect(r.mine).toEqual([]);
    expect(r.theirs).toEqual([]);
    expect(r.collisions).toEqual([]);
  });

  it('still notices a different image', () => {
    const other = { ...blobRef, ref: { $link: 'bafkreiother' } };
    const r = threeWay(
      tl([withoutUrl]),
      tl([{ ...withoutUrl, media: { blobRef: other } }]),
      tl([withoutUrl]),
    );
    expect(r.mine).toEqual([{ id: 'moon', kind: 'edited', fields: ['media'] }]);
  });
});
