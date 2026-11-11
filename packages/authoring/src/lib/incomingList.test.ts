/**
 * @vitest-environment happy-dom
 *
 * What a merge or fast-forward brought in, and putting it back.
 *
 * The rows are `PullEntry` like any other, so they go back through
 * `applyPull` — these assert that the inversion is right: the version a row
 * carries is the one from *before*, so a slide that arrived is a row that
 * removes it.
 */
import { describe, it, expect } from 'vitest';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';
import { TimelineDoc } from './doc.svelte.ts';
import { SETTINGS_ID } from './threeWay.ts';
import { applyPull, incomingList, outstanding } from './pullList.ts';

const moon: TLEvent = { unique_id: 'moon', start_date: { year: 1969 }, text: { headline: 'Apollo 11' } };
const voyager: TLEvent = { unique_id: 'voyager', start_date: { year: 1977 }, text: { headline: 'Voyager 1' } };
const tl = (events: TLEvent[], extra: Partial<TLTimeline> = {}): TLTimeline => ({ events, ...extra });

const load = (timeline: TLTimeline): TimelineDoc => {
  const doc = new TimelineDoc();
  doc.load(timeline);
  return doc;
};

describe('what arrived', () => {
  it('names a slide that was added, as a row that would remove it', () => {
    const { entries } = incomingList(tl([moon]), tl([moon, voyager]));
    expect(entries).toMatchObject([{ id: 'voyager', kind: 'removed', label: 'Voyager 1' }]);
  });

  it('names a slide that was deleted elsewhere, as a row that would restore it', () => {
    const { entries } = incomingList(tl([moon, voyager]), tl([moon]));
    expect(entries).toMatchObject([{ id: 'voyager', kind: 'added', event: voyager }]);
  });

  it('shows what an edit changed, field by field', () => {
    const after = tl([{ ...moon, text: { headline: 'Apollo 11 — the landing' } }]);
    const [entry] = incomingList(tl([moon]), after).entries;
    expect(entry.diffs).toEqual([
      {
        key: 'headline',
        label: 'Headline',
        here: 'Apollo 11 — the landing',
        theirs: 'Apollo 11',
        long: false,
      },
    ]);
  });

  it('says nothing when the document did not move', () => {
    expect(incomingList(tl([moon]), tl([moon])).entries).toEqual([]);
  });

  it('counts the settings as a row of their own', () => {
    const { entries } = incomingList(
      tl([moon], { settings: { theme: 'light' } }),
      tl([moon], { settings: { theme: 'dark' } }),
    );
    expect(entries.map((e) => e.id)).toEqual([SETTINGS_ID]);
    expect(entries[0].settings).toEqual({ theme: 'light' });
  });
});

describe('putting an incoming change back', () => {
  it('removes a slide that arrived', () => {
    const doc = load(tl([moon, voyager]));
    const [entry] = incomingList(tl([moon]), doc.toTimeline()).entries;

    applyPull(doc, entry);
    expect(doc.events.map((e) => e.unique_id)).toEqual(['moon']);
  });

  it('restores a slide deleted in the other browser', () => {
    const doc = load(tl([moon]));
    const [entry] = incomingList(tl([moon, voyager]), doc.toTimeline()).entries;

    applyPull(doc, entry);
    expect(doc.events.map((e) => e.unique_id).sort()).toEqual(['moon', 'voyager']);
  });

  it('is an ordinary edit, so undo reaches it', () => {
    // The merge itself is not undoable — `adopt` clears the stack — which is
    // exactly why each row has to be.
    const doc = load(tl([moon, voyager]));
    applyPull(doc, incomingList(tl([moon]), doc.toTimeline()).entries[0]);
    expect(doc.events).toHaveLength(1);

    doc.undo();
    expect(doc.events.map((e) => e.unique_id).sort()).toEqual(['moon', 'voyager']);
  });

  it('leaves the row outstanding until the document matches it', () => {
    const doc = load(tl([moon, voyager]));
    const [entry] = incomingList(tl([moon]), doc.toTimeline()).entries;
    expect(outstanding(entry, doc.toTimeline())).toBe(true);

    applyPull(doc, entry);
    expect(outstanding(entry, doc.toTimeline())).toBe(false);

    doc.undo();
    expect(outstanding(entry, doc.toTimeline())).toBe(true);
  });

  it('puts the settings back as they were', () => {
    const doc = load(tl([moon], { settings: { theme: 'dark', initialIndex: 3 } }));
    const [entry] = incomingList(tl([moon], { settings: { theme: 'light' } }), doc.toTimeline()).entries;

    applyPull(doc, entry);
    expect(doc.settings.theme).toBe('light');
    expect(doc.settings.initialIndex).toBeUndefined();
  });
});

describe('settings nobody changed', () => {
  // Found by hand: a merge reported "One change published from another
  // browser: Settings", and the panel had nothing to show under it. The two
  // sides were not equal — one spelled "no settings" as an absent value, the
  // other as an empty object — and no key differed, so the row could not be
  // read and, until the comparison agreed with itself, could not be cleared
  // either.
  it('does not report a settings change between no settings and empty settings', () => {
    expect(incomingList(tl([moon]), tl([moon], { settings: {} })).entries).toEqual([]);
    expect(incomingList(tl([moon], { settings: {} }), tl([moon])).entries).toEqual([]);
  });

  it('treats a cleared setting as no setting', () => {
    const before = tl([moon], { settings: { theme: 'dark' } });
    const after = tl([moon], { settings: { theme: undefined, language: '' } as never });
    // A real change — the theme went away — so this one is a row, and the
    // emptied keys are not.
    expect(incomingList(before, after).entries.map((e) => e.id)).toEqual([SETTINGS_ID]);
    expect(incomingList(after, tl([moon])).entries).toEqual([]);
  });

  it('never offers a settings row it cannot put a value against', () => {
    // The guard behind the fix above: whatever the structural test says, a
    // row with no showable difference is not offered.
    const odd = tl([moon], { settings: { unknownFuture: null } as never });
    expect(incomingList(tl([moon]), odd).entries).toEqual([]);
  });
});

describe('two browsers adding a slide under the same id', () => {
  // The scenario that turned the phantom settings row up. Both sides invent
  // "launch" independently, so there is no shared ancestor for it — the row
  // has to be an ordinary edit against whatever arrived, with both versions
  // on show, and nothing about it may touch the settings.
  const mine: TLEvent = { unique_id: 'launch', start_date: { year: 1961 }, text: { headline: 'Mine' } };
  const theirs: TLEvent = { unique_id: 'launch', start_date: { year: 1961 }, text: { headline: 'Theirs' } };

  it('offers one row holding both headlines, and no settings row', () => {
    const { entries } = incomingList(tl([moon, mine]), tl([moon, theirs]));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'launch', kind: 'edited' });
    expect(entries[0].diffs).toMatchObject([{ key: 'headline', here: 'Theirs', theirs: 'Mine' }]);
  });

  it('clears the row once the choice is made', () => {
    const before = tl([moon, mine]);
    const after = tl([moon, theirs]);
    const [entry] = incomingList(before, after).entries;
    const doc = load(after);
    applyPull(doc, entry);
    expect(outstanding(entry, doc.toTimeline())).toBe(false);
  });
});
