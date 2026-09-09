/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import type { TLEvent } from '@knight-lab/timeline-ng-core';
import { TimelineDoc } from './doc.svelte.ts';

const moon: TLEvent = {
  unique_id: 'the-moon-landing',
  start_date: { year: 1969, month: 7, day: 20 },
  text: { headline: 'The Moon Landing' },
};
const sputnik: TLEvent = {
  unique_id: 'sputnik',
  start_date: { year: 1957, month: 10, day: 4 },
  text: { headline: 'Sputnik 1' },
};

describe('TimelineDoc snapshot', () => {
  it('reflects a load', () => {
    const t = new TimelineDoc();
    t.load({ title: { unique_id: 'title' }, events: [moon, sputnik], settings: { language: 'es' } });

    expect(t.events.map((e) => e.unique_id)).toEqual(['sputnik', 'the-moon-landing']);
    expect(t.titleEvent).toEqual({ unique_id: 'title' });
    expect(t.settings).toEqual({ language: 'es' });
  });

  it('updates synchronously after a mutation', () => {
    const t = new TimelineDoc();
    t.load({ events: [], settings: {} });

    t.addEvent(moon);
    expect(t.events).toHaveLength(1);

    t.removeEvent(t.entries[0].key);
    expect(t.events).toEqual([]);
  });

  it('keeps the internal key stable across a unique_id rename', () => {
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} });
    const before = t.entries[0].key;

    t.updateEvent(t.entries[0].key, { ...moon, unique_id: 'apollo-11' });

    expect(t.entries[0].key).toBe(before);
    expect(t.events[0].unique_id).toBe('apollo-11');
  });
});

describe('clean', () => {
  it('starts clean after a load and dirties on edit', () => {
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} });
    expect(t.clean).toBe(true);

    // Not a prose edit: those reach the document through the fragments, not
    // through updateEvent, which ignores its copy of the HTML entirely.
    t.updateEvent(t.entries[0].key, { ...moon, group: 'Missions' });
    expect(t.clean).toBe(false);
  });

  it('is dirty from the start when loaded as unsaved', () => {
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} }, {}, { clean: false });
    expect(t.clean).toBe(false);
  });

  it('reports clean again once an edit is reversed', () => {
    // The old hand-set pdsClean flag could not do this: it only ever went one
    // way until a save. Comparing content means undo restores cleanliness.
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} });

    t.updateEvent(t.entries[0].key, { ...moon, group: 'Missions' });
    expect(t.clean).toBe(false);

    t.updateEvent(t.entries[0].key, moon);
    expect(t.clean).toBe(true);
  });

  it('is clean again after markClean', () => {
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} });
    t.addEvent(sputnik);
    expect(t.clean).toBe(false);

    t.markClean();
    expect(t.clean).toBe(true);
  });

  it('ignores meta when deciding cleanliness', () => {
    // atUri and the timeline title are document metadata, not content.
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} });
    t.setAtUri('at://did:plc:x/com.knightlab.timeline/1');
    expect(t.clean).toBe(true);
  });
});

describe('title metadata', () => {
  it('round-trips an explicit title', () => {
    const t = new TimelineDoc();
    t.setTitle('Spaceflight', true);
    expect(t.title).toBe('Spaceflight');
    expect(t.titleSetByUser).toBe(true);
  });

  it('treats an empty title as unset', () => {
    const t = new TimelineDoc();
    t.setTitle('Spaceflight', true);
    t.setTitle('', false);
    expect(t.title).toBe('');
    expect(t.titleSetByUser).toBe(false);
  });

  it('does not emit a document update when the title is rewritten unchanged', () => {
    // App.svelte derives the timeline title from the title slide's headline in an
    // effect that also writes it back. Without this, that effect would loop.
    const t = new TimelineDoc();
    t.setTitle('Spaceflight', false);

    let updates = 0;
    t.doc.on('update', () => { updates += 1; });
    t.setTitle('Spaceflight', false);

    expect(updates).toBe(0);
  });
});

describe('reactivity', () => {
  it('drives a $derived that reads the snapshot', () => {
    const t = new TimelineDoc();
    t.load({ events: [moon], settings: {} });

    const cleanup = $effect.root(() => {
      const headlines = $derived(t.events.map((e) => e.text?.headline));
      let seen: (string | undefined)[] = [];
      $effect(() => { seen = headlines; });
      flushSync();
      expect(seen).toEqual(['The Moon Landing']);

      t.addEvent(sputnik);
      flushSync();
      expect(seen).toEqual(['Sputnik 1', 'The Moon Landing']);
    });
    cleanup();
  });
});

describe('identity is the internal key, not unique_id', () => {
  // `unique_id` is author-facing and editable, and nothing makes it unique:
  // two collaborators can pick the same one at the same time, and uniqueness is
  // only enforced as a validation pass at publish. Anything that treated it as
  // identity — the editor's selection, list keying, "which slide am I writing
  // to" — would address the wrong slide, or two slides at once.
  it('keeps duplicate-named slides separately addressable', () => {
    const t = new TimelineDoc();
    t.load({ events: [], settings: {} });
    const a = t.addEvent({ unique_id: 'apollo', text: { headline: 'First' } });
    const b = t.addEvent({ unique_id: 'apollo', text: { headline: 'Second' } });

    expect(a).not.toBe(b);
    expect(t.eventForKey(a)?.text?.headline).toBe('First');
    expect(t.eventForKey(b)?.text?.headline).toBe('Second');

    // Not prose: `writeSlide` ignores the fields the fragments own, so a
    // headline changes through its fragment and never through here.
    t.updateEvent(b, { unique_id: 'apollo', group: 'Missions' });
    expect(t.eventForKey(a)?.group).toBeUndefined();
    expect(t.eventForKey(b)?.group).toBe('Missions');
    expect(t.eventForKey(a)?.text?.headline).toBe('First');

    t.removeEvent(a);
    expect(t.entries.map((e) => e.key)).toEqual([b]);
  });

  it('survives a rename mid-word, which is what lets the ID field commit on input', () => {
    const t = new TimelineDoc();
    t.load({ events: [], settings: {} });
    const key = t.addEvent({ unique_id: 'm', text: { headline: 'Moon' } });

    for (const id of ['mo', 'moo', 'moon', 'moon-l', 'moon-landing']) {
      t.updateEvent(key, { unique_id: id, text: { headline: 'Moon' } });
      expect(t.entries.map((e) => e.key)).toEqual([key]);
    }
    expect(t.eventForKey(key)?.unique_id).toBe('moon-landing');
  });
});
