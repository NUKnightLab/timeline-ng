/**
 * @vitest-environment happy-dom
 *
 * `addEvent` seeds rich-text fragments, and that parses HTML.
 */
import { describe, it, expect } from 'vitest';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';
import { TimelineDoc } from './doc.svelte.ts';
import { SETTINGS_ID, TITLE_ID } from './threeWay.ts';
import { applyPull, applyPullField, declinePull, declinePullField, pullList } from './pullList.ts';

const moon: TLEvent = { unique_id: 'moon', start_date: { year: 1969 }, text: { headline: 'Apollo 11' } };
const voyager: TLEvent = { unique_id: 'voyager', start_date: { year: 1977 }, text: { headline: 'Voyager 1' } };

const tl = (events: TLEvent[], extra: Partial<TLTimeline> = {}): TLTimeline => ({ events, ...extra });
const edit = (ev: TLEvent, patch: Partial<TLEvent>): TLEvent => ({ ...ev, ...patch });

describe('what a fork still has to give', () => {
  it('lists the fork\'s own changes and nothing else', () => {
    // The working document moved too. Its changes are not the fork's to offer,
    // and showing them would turn the panel into a two-way diff.
    const base = tl([moon]);
    const fork = tl([edit(moon, { group: 'Missions' })]);
    const working = tl([moon, voyager]);

    const { entries } = pullList(base, fork, working);
    expect(entries).toEqual([
      {
        id: 'moon',
        kind: 'edited',
        label: 'Apollo 11',
        event: fork.events[0],
        contested: false,
        diffs: [{ key: 'group', label: 'Group', here: '—', theirs: 'Missions', long: false }],
      },
    ]);
  });

  it('says nothing when the fork has already been worked through', () => {
    const base = tl([moon]);
    const fork = tl([edit(moon, { group: 'Missions' })]);

    // The working document now holds the fork's version: brought over earlier,
    // and so not a row any more. This is what makes the list empty out.
    expect(pullList(base, fork, tl([edit(moon, { group: 'Missions' })])).entries).toEqual([]);
  });

  it('marks a row contested when bringing it over would replace something', () => {
    const base = tl([moon]);
    const fork = tl([edit(moon, { group: 'Missions' })]);
    const working = tl([edit(moon, { group: 'Apollo' })]);

    const { entries } = pullList(base, fork, working);
    expect(entries).toMatchObject([{ id: 'moon', contested: true, fields: ['group'] }]);
  });

  it('offers a slide the fork added', () => {
    const { entries } = pullList(tl([moon]), tl([moon, voyager]), tl([moon]));
    expect(entries).toEqual([
      { id: 'voyager', kind: 'added', label: 'Voyager 1', event: voyager, contested: false },
    ]);
  });

  it('offers a removal the fork made, labelled from the version that still exists', () => {
    const { entries } = pullList(tl([moon, voyager]), tl([moon]), tl([moon, voyager]));
    expect(entries).toEqual([
      { id: 'voyager', kind: 'removed', label: 'Voyager 1', contested: false },
    ]);
  });

  it('strips markup out of a row label', () => {
    const tagged: TLEvent = { unique_id: 'x', start_date: { year: 1999 }, text: { headline: '<p>Joe was born</p>' } };
    const { entries } = pullList(tl([]), tl([tagged]), tl([]));
    expect(entries[0].label).toBe('Joe was born');
  });

  it('treats the title slide and the settings as rows of their own', () => {
    const base = tl([moon], { title: { text: { headline: 'Space' } }, settings: { theme: 'light' } });
    const fork = tl([moon], { title: { text: { headline: 'Spaceflight' } }, settings: { theme: 'dark' } });

    const { entries } = pullList(base, fork, base);
    expect(entries.map((e) => e.id).sort()).toEqual([SETTINGS_ID, TITLE_ID].sort());
    expect(entries.find((e) => e.id === SETTINGS_ID)?.settings).toEqual({ theme: 'dark' });
  });

  it('counts slides it cannot match rather than dropping them in silence', () => {
    const unkeyed = { start_date: { year: 1961 }, text: { headline: 'Vostok 1' } } as TLEvent;
    expect(pullList(tl([moon]), tl([moon, unkeyed]), tl([moon])).unmatchable).toBe(1);
  });
});

describe('bringing an entry over', () => {
  const load = (timeline: TLTimeline): TimelineDoc => {
    const doc = new TimelineDoc();
    doc.load(timeline);
    return doc;
  };

  it('writes the fork\'s version over the working one', () => {
    const doc = load(tl([moon]));
    const fork = tl([edit(moon, { group: 'Missions' })]);
    const { entries } = pullList(tl([moon]), fork, doc.toTimeline());

    applyPull(doc, entries[0]);
    expect(doc.events[0].group).toBe('Missions');
  });

  it('can be undone, which is what makes the panel safe to poke at', () => {
    const doc = load(tl([moon]));
    const fork = tl([edit(moon, { group: 'Missions' })]);
    applyPull(doc, pullList(tl([moon]), fork, doc.toTimeline()).entries[0]);

    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.events[0].group).toBeUndefined();
  });

  it('reappears as a row once undone', () => {
    const doc = load(tl([moon]));
    const fork = tl([edit(moon, { group: 'Missions' })]);
    applyPull(doc, pullList(tl([moon]), fork, doc.toTimeline()).entries[0]);
    expect(pullList(tl([moon]), fork, doc.toTimeline()).entries).toEqual([]);

    doc.undo();
    expect(pullList(tl([moon]), fork, doc.toTimeline()).entries).toHaveLength(1);
  });

  it('adds a slide the working document does not have', () => {
    const doc = load(tl([moon]));
    const { entries } = pullList(tl([moon]), tl([moon, voyager]), doc.toTimeline());

    applyPull(doc, entries[0]);
    expect(doc.events.map((e) => e.unique_id)).toEqual(['moon', 'voyager']);
  });

  it('carries a removal over', () => {
    const doc = load(tl([moon, voyager]));
    const { entries } = pullList(tl([moon, voyager]), tl([moon]), doc.toTimeline());

    applyPull(doc, entries[0]);
    expect(doc.events.map((e) => e.unique_id)).toEqual(['moon']);
  });

  it('clears a setting the fork dropped rather than leaving it behind', () => {
    // A patch of only the keys present would quietly keep `initialIndex`,
    // which is the same deletion bug the three-way merge had.
    const doc = load(tl([moon], { settings: { theme: 'light', initialIndex: 2 } }));
    const fork = tl([moon], { settings: { theme: 'dark' } });
    const { entries } = pullList(tl([moon], { settings: { theme: 'light', initialIndex: 2 } }), fork, doc.toTimeline());

    applyPull(doc, entries[0]);
    expect(doc.settings.theme).toBe('dark');
    expect(doc.settings.initialIndex).toBeUndefined();
  });

  it('brings the fork\'s prose over, not just its scalar fields', () => {
    // Ordinary slide writes leave rich text alone on purpose, so a pull that
    // used one would report success and change nothing anyone could see.
    const headline = (text: string): TLEvent => ({ ...moon, text: { headline: text } });
    const doc = load(tl([headline('Apollo 11')]));
    const fork = tl([headline('Apollo 11 — the landing')]);
    const { entries } = pullList(tl([headline('Apollo 11')]), fork, doc.toTimeline());

    applyPull(doc, entries[0]);
    expect(doc.events[0].text?.headline).toContain('the landing');

    doc.undo();
    expect(doc.events[0].text?.headline).toContain('Apollo 11');
    expect(doc.events[0].text?.headline).not.toContain('the landing');
  });

  it('brings the title slide over', () => {
    const doc = load(tl([moon], { title: { text: { headline: 'Space' } } }));
    const fork = tl([moon], { title: { text: { headline: 'Spaceflight' } } });
    const { entries } = pullList(tl([moon], { title: { text: { headline: 'Space' } } }), fork, doc.toTimeline());

    applyPull(doc, entries[0]);
    expect(doc.titleEvent?.text?.headline).toContain('Spaceflight');
  });
});

describe('taking one field of a row', () => {
  const load = (timeline: TLTimeline): TimelineDoc => {
    const doc = new TimelineDoc();
    doc.load(timeline);
    return doc;
  };

  const full = (patch: Partial<TLEvent>): TLEvent => ({
    unique_id: 'moon',
    start_date: { year: 1969 },
    text: { headline: 'Apollo 11' },
    ...patch,
  });

  it('writes that field and leaves the rest of the slide as it was', () => {
    const here = full({ group: 'Missions' });
    const fork = tl([full({ text: { headline: 'Apollo 11 — the landing' }, group: 'Apollo' })]);
    const doc = load(tl([here]));
    const { entries } = pullList(tl([here]), fork, doc.toTimeline());

    applyPullField(doc, entries[0], 'headline');
    expect(doc.events[0].text?.headline).toContain('the landing');
    expect(doc.events[0].group).toBe('Missions');
  });

  it('leaves the row on offer while anything else still differs', () => {
    const here = full({ group: 'Missions' });
    const fork = tl([full({ text: { headline: 'Changed' }, group: 'Apollo' })]);
    const doc = load(tl([here]));
    applyPullField(doc, pullList(tl([here]), fork, doc.toTimeline()).entries[0], 'headline');

    const after = pullList(tl([here]), fork, doc.toTimeline());
    expect(after.entries).toHaveLength(1);
    expect(after.entries[0].diffs?.map((d) => d.key)).toEqual(['group']);
  });

  it('empties the row once every field has been taken', () => {
    const here = full({ group: 'Missions' });
    const fork = tl([full({ text: { headline: 'Changed' }, group: 'Apollo' })]);
    const doc = load(tl([here]));
    for (const key of ['headline', 'group']) {
      const entry = pullList(tl([here]), fork, doc.toTimeline()).entries[0];
      applyPullField(doc, entry, key);
    }
    expect(pullList(tl([here]), fork, doc.toTimeline()).entries).toEqual([]);
  });

  it('is one undo, like any other pull', () => {
    const here = full({});
    const fork = tl([full({ text: { headline: 'Changed' } })]);
    const doc = load(tl([here]));
    applyPullField(doc, pullList(tl([here]), fork, doc.toTimeline()).entries[0], 'headline');

    doc.undo();
    expect(doc.events[0].text?.headline).toContain('Apollo 11');
  });

  it('takes one setting without the others', () => {
    const base = tl([full({})], { settings: { theme: 'light', initialIndex: 2 } });
    const fork = tl([full({})], { settings: { theme: 'dark', initialIndex: 5 } });
    const doc = load(base);
    const entry = pullList(base, fork, doc.toTimeline()).entries.find((e) => e.id === SETTINGS_ID)!;

    applyPullField(doc, entry, 'theme');
    expect(doc.settings.theme).toBe('dark');
    expect(doc.settings.initialIndex).toBe(2);
  });

  it('takes the title slide\'s headline on its own', () => {
    const base = tl([full({})], { title: { text: { headline: 'Space' }, group: 'Intro' } });
    const fork = tl([full({})], { title: { text: { headline: 'Spaceflight' }, group: 'Intro' } });
    const doc = load(base);
    const entry = pullList(base, fork, doc.toTimeline()).entries.find((e) => e.id === TITLE_ID)!;

    applyPullField(doc, entry, 'headline');
    expect(doc.titleEvent?.text?.headline).toContain('Spaceflight');
    expect(doc.titleEvent?.group).toBe('Intro');
  });
});

describe('settling a row the other way', () => {
  // Declining is recorded in the fork's ancestor rather than in a list of
  // dismissed rows, so these all assert through a recomputed pull-list: that
  // is the only thing the panel ever reads.
  const moonEdited = edit(moon, { group: 'Missions' });

  it('stops offering the row', () => {
    const base = tl([moon]);
    const fork = tl([moonEdited]);
    const working = tl([moon]);

    const settled = declinePull(base, fork, pullList(base, fork, working).entries[0]);
    expect(pullList(settled, fork, working).entries).toEqual([]);
  });

  it('leaves the working document alone — it is a decision, not an edit', () => {
    const base = tl([moon]);
    const fork = tl([moonEdited]);
    const working = tl([moon, voyager]);

    declinePull(base, fork, pullList(base, fork, working).entries[0]);
    expect(working.events).toEqual([moon, voyager]);
  });

  it('keeps the row settled however far the working document travels', () => {
    // The point of recording it in the ancestor: the fork has nothing more to
    // say about that slide, whatever happens here afterwards.
    const base = tl([moon]);
    const fork = tl([moonEdited]);
    const settled = declinePull(base, fork, pullList(base, fork, tl([moon])).entries[0]);

    const later = tl([edit(moon, { group: 'Apollo' }), voyager]);
    expect(pullList(settled, fork, later).entries).toEqual([]);
  });

  it('settles a slide the fork added without adding it', () => {
    const base = tl([moon]);
    const fork = tl([moon, voyager]);
    const working = tl([moon]);

    const settled = declinePull(base, fork, pullList(base, fork, working).entries[0]);
    expect(pullList(settled, fork, working).entries).toEqual([]);
    expect(working.events.map((e) => e.unique_id)).toEqual(['moon']);
  });

  it('settles a deletion by keeping the slide here', () => {
    const base = tl([moon, voyager]);
    const fork = tl([moon]);
    const working = tl([moon, voyager]);

    const settled = declinePull(base, fork, pullList(base, fork, working).entries[0]);
    expect(pullList(settled, fork, working).entries).toEqual([]);
    expect(working.events.map((e) => e.unique_id)).toEqual(['moon', 'voyager']);
  });

  it('settles the settings row', () => {
    const base = tl([moon], { settings: { theme: 'light' } });
    const fork = tl([moon], { settings: { theme: 'dark' } });
    const working = tl([moon], { settings: { theme: 'light' } });

    const settled = declinePull(base, fork, pullList(base, fork, working).entries[0]);
    expect(pullList(settled, fork, working).entries).toEqual([]);
  });

  it('settles the title slide', () => {
    const base = tl([moon], { title: { text: { headline: 'Space' } } });
    const fork = tl([moon], { title: { text: { headline: 'Spaceflight' } } });
    const working = tl([moon], { title: { text: { headline: 'Space' } } });

    const settled = declinePull(base, fork, pullList(base, fork, working).entries[0]);
    expect(pullList(settled, fork, working).entries).toEqual([]);
  });

  it('leaves every other row on offer', () => {
    const base = tl([moon, voyager]);
    const fork = tl([moonEdited, edit(voyager, { group: 'Probes' })]);
    const working = tl([moon, voyager]);

    const { entries } = pullList(base, fork, working);
    const settled = declinePull(base, fork, entries[0]);
    expect(pullList(settled, fork, working).entries.map((e) => e.id)).toEqual([entries[1].id]);
  });
});

describe('answering one line at a time', () => {
  // The question behind this: with *Keep mine* the only per-line button, the
  // row's *Keep published* might have been read as undoing lines already
  // answered. Each line now carries both, and these pin down what each one
  // reaches.
  const base = tl([moon]);
  const fork = tl([edit(moon, { group: 'Missions', text: { headline: 'Apollo 11 — the landing' } })]);
  const working = tl([moon]);

  it('offers both fields as lines', () => {
    const [entry] = pullList(base, fork, working).entries;
    expect(entry.diffs?.map((d) => d.key)).toEqual(['headline', 'group']);
  });

  it('settles one line without touching the other', () => {
    const [entry] = pullList(base, fork, working).entries;
    const next = declinePullField(base, fork, entry, 'group');

    const [after] = pullList(next, fork, working).entries;
    expect(after.diffs?.map((d) => d.key)).toEqual(['headline']);
  });

  it('keeps a line that was already answered answered, whichever way the row goes', () => {
    // Keep mine on the headline, keep published on the group, and the row is
    // empty: the row-level button can only ever have reached what was left.
    const [entry] = pullList(base, fork, working).entries;
    const doc = new TimelineDoc();
    doc.load(working);
    applyPullField(doc, entry, 'headline');
    const next = declinePullField(base, fork, entry, 'group');

    expect(pullList(next, fork, doc.toTimeline()).entries).toEqual([]);
    expect(doc.toTimeline().events[0].text?.headline).toBe('Apollo 11 — the landing');
    expect(doc.toTimeline().events[0].group).toBeUndefined();
  });

  it('does not offer a field only the published side changed', () => {
    // The trap this closes: the draft never touched the date, so a *Keep
    // mine* on it would revert someone else's published work under the guise
    // of keeping your own.
    const published = tl([edit(moon, { start_date: { year: 1970 } })]);
    const [entry] = pullList(base, fork, published).entries;
    expect(entry.diffs?.map((d) => d.key)).toEqual(['headline', 'group']);
  });

  it('settles one setting without settling the rest', () => {
    const settingsBase = tl([moon], { settings: { theme: 'light', language: 'en' } });
    const settingsFork = tl([moon], { settings: { theme: 'dark', language: 'es' } });
    const [entry] = pullList(settingsBase, settingsFork, settingsBase).entries;
    expect(entry.id).toBe(SETTINGS_ID);

    const next = declinePullField(settingsBase, settingsFork, entry, 'theme');
    const [after] = pullList(next, settingsFork, settingsBase).entries;
    expect(after.diffs?.map((d) => d.key)).toEqual(['language']);
  });

  it('settles a line of the title slide', () => {
    const titleBase = tl([moon], { title: { unique_id: 'title', text: { headline: 'Space' } } });
    const titleFork = tl([moon], { title: { unique_id: 'title', text: { headline: 'The space race' } } });
    const [entry] = pullList(titleBase, titleFork, titleBase).entries;
    expect(entry.id).toBe(TITLE_ID);

    const next = declinePullField(titleBase, titleFork, entry, 'headline');
    expect(pullList(next, titleFork, titleBase).entries).toEqual([]);
  });
});

describe('a slide both sides invented', () => {
  // Found by hand: a title slide added in two browsers produced a row saying
  // "You added this; the published timeline does not have it" directly above
  // a comparison showing the published version of it, with a button offering
  // to "add the slide" that would in fact have replaced one.
  const titleOf = (headline: string) => ({ unique_id: 'title', text: { headline } });
  const base = tl([moon]);
  const fork = tl([moon], { title: titleOf('arc wants one too') });
  const working = tl([moon], { title: titleOf('Zen wants a title') });

  it('is an edit, because answering it replaces what is there', () => {
    const [entry] = pullList(base, fork, working).entries;
    expect(entry).toMatchObject({ id: TITLE_ID, kind: 'edited', rival: true });
  });

  it('shows both headlines, since neither side inherited one', () => {
    const [entry] = pullList(base, fork, working).entries;
    expect(entry.diffs).toMatchObject([
      { key: 'headline', here: 'Zen wants a title', theirs: 'arc wants one too' },
    ]);
  });

  it('replaces rather than adds when it is answered', () => {
    const [entry] = pullList(base, fork, working).entries;
    const doc = new TimelineDoc();
    doc.load(working);
    applyPull(doc, entry);
    expect(doc.toTimeline().title?.text?.headline).toBe('arc wants one too');
    expect(pullList(base, fork, doc.toTimeline()).entries).toEqual([]);
  });

  it('is still a plain addition when only the draft has one', () => {
    const [entry] = pullList(base, fork, tl([moon])).entries;
    expect(entry).toMatchObject({ kind: 'added' });
    expect(entry.rival).toBeUndefined();
  });

  it('is a plain edit when both sides inherited it', () => {
    const inherited = tl([moon], { title: titleOf('Space') });
    const [entry] = pullList(inherited, fork, inherited).entries;
    expect(entry).toMatchObject({ kind: 'edited' });
    expect(entry.rival).toBeUndefined();
  });
});
