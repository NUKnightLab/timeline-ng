import { describe, it, expect } from 'vitest';
import { fromTL3 } from '@knight-lab/timeline-ng-core';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';
import {
  addSlide, createDoc, docToTimeline, hasTitleSlide, listSlides, loadTimeline,
  readMeta, readSlide, removeSlide, slidesMap, titleMap, writeMeta, writeSettings, writeSlide,
} from './doc.ts';

const moon: TLEvent = {
  unique_id: 'the-moon-landing',
  start_date: { year: 1969, month: 7, day: 20 },
  text: { headline: 'The Moon Landing', text: '<p>One small step.</p>' },
  media: { url: 'https://example.com/moon.jpg', caption: 'Apollo 11', credit: 'NASA', alt: 'Lunar surface' },
};

const sputnik: TLEvent = {
  unique_id: 'sputnik',
  start_date: { year: 1957, month: 10, day: 4 },
  text: { headline: 'Sputnik 1' },
  media_position: 'right',
  group: 'Space race',
};

const titleSlide: TLEvent = {
  unique_id: 'title',
  text: { headline: 'A History of Spaceflight' },
  background: { color: '#101820' },
};

function timeline(overrides: Partial<TLTimeline> = {}): TLTimeline {
  return {
    title: titleSlide,
    events: [moon, sputnik],
    settings: { language: 'en', theme: 'auto', initialIndex: 0, reverseOrder: false },
    ...overrides,
  };
}

describe('round-tripping a timeline', () => {
  it('preserves a timeline through the document and back', () => {
    const doc = createDoc();
    loadTimeline(doc, timeline());
    const out = docToTimeline(doc);

    expect(out.title).toEqual(titleSlide);
    expect(out.settings).toEqual(timeline().settings);
    // Ordering is derived from dates, so Sputnik (1957) precedes the landing (1969)
    // regardless of the order they were written in.
    expect(out.events).toEqual([sputnik, moon]);
  });

  it('round-trips a timeline with no title slide', () => {
    const doc = createDoc();
    loadTimeline(doc, { events: [moon], settings: {} });
    expect(hasTitleSlide(doc)).toBe(false);
    expect(docToTimeline(doc).title).toBeUndefined();
  });

  it('round-trips an empty timeline', () => {
    const doc = createDoc();
    loadTimeline(doc, { events: [], settings: {} });
    expect(docToTimeline(doc)).toEqual({ events: [], settings: {} });
  });

  it('drops empty nested objects rather than materialising them', () => {
    const doc = createDoc();
    loadTimeline(doc, { events: [{ unique_id: 'bare', text: {}, media: {} }], settings: {} });
    expect(docToTimeline(doc).events[0]).toEqual({ unique_id: 'bare' });
  });

  it('keeps blobRef intact as an opaque value', () => {
    const blobRef = { $type: 'blob' as const, ref: { $link: 'bafyxyz' }, mimeType: 'image/jpeg', size: 1234 };
    const doc = createDoc();
    loadTimeline(doc, { events: [{ unique_id: 'b', media: { blobRef, mimeType: 'image/jpeg' } }], settings: {} });
    expect(docToTimeline(doc).events[0].media?.blobRef).toEqual(blobRef);
  });

  it('sinks undated slides below dated ones', () => {
    const doc = createDoc();
    loadTimeline(doc, { events: [{ unique_id: 'undated' }, moon], settings: {} });
    expect(docToTimeline(doc).events.map((e) => e.unique_id)).toEqual(['the-moon-landing', 'undated']);
  });

  it('orders slides sharing a date deterministically', () => {
    const same = (id: string): TLEvent => ({ unique_id: id, start_date: { year: 2000 } });
    const a = createDoc();
    const b = createDoc();
    loadTimeline(a, { events: [same('x'), same('y'), same('z')], settings: {} });
    loadTimeline(b, { events: [same('z'), same('y'), same('x')], settings: {} });
    // Different insertion orders, but each document reads back the same way twice.
    expect(docToTimeline(a).events).toEqual(docToTimeline(a).events);
    expect(docToTimeline(b).events).toEqual(docToTimeline(b).events);
  });
});

describe('slide keys', () => {
  it('keys slides by an internal id, not by unique_id', () => {
    const doc = createDoc();
    loadTimeline(doc, { events: [moon], settings: {} });
    const [entry] = listSlides(doc);
    expect(entry.key).not.toBe('the-moon-landing');
    expect(entry.event.unique_id).toBe('the-moon-landing');
  });

  it('survives a unique_id rename without re-keying', () => {
    const doc = createDoc();
    loadTimeline(doc, { events: [moon], settings: {} });
    const { key } = listSlides(doc)[0];

    slidesMap(doc).get(key)!.set('unique_id', 'apollo-11');

    expect(listSlides(doc)[0].key).toBe(key);
    expect(listSlides(doc)[0].event.unique_id).toBe('apollo-11');
  });

  it('gives every added slide a distinct key', () => {
    const doc = createDoc();
    const keys = new Set([addSlide(doc, {}), addSlide(doc, {}), addSlide(doc, {})]);
    expect(keys.size).toBe(3);
    expect(slidesMap(doc).size).toBe(3);
  });

  it('removes a slide by key', () => {
    const doc = createDoc();
    const key = addSlide(doc, moon);
    removeSlide(doc, key);
    expect(docToTimeline(doc).events).toEqual([]);
  });
});

describe('writeSlide', () => {
  it('clears fields that are absent from the new value', () => {
    const doc = createDoc();
    const key = addSlide(doc, moon);
    const slide = slidesMap(doc).get(key)!;

    writeSlide(slide, { unique_id: 'the-moon-landing' });

    expect(readSlide(slide)).toEqual({ unique_id: 'the-moon-landing' });
  });

  it('clears sub-fields that are absent from the new value', () => {
    const doc = createDoc();
    const key = addSlide(doc, moon);
    const slide = slidesMap(doc).get(key)!;

    writeSlide(slide, { ...moon, media: { url: 'https://example.com/moon.jpg' } });

    expect(readSlide(slide).media).toEqual({ url: 'https://example.com/moon.jpg' });
  });

  it('reuses the nested map rather than replacing it', () => {
    // Replacing it would discard concurrent edits to sibling sub-fields once
    // there is more than one writer.
    const doc = createDoc();
    const key = addSlide(doc, moon);
    const slide = slidesMap(doc).get(key)!;
    const before = slide.get('media');

    writeSlide(slide, { ...moon, media: { ...moon.media, caption: 'Changed' } });

    expect(slide.get('media')).toBe(before);
  });
});

describe('settings and meta', () => {
  it('round-trips settings and drops removed keys', () => {
    const doc = createDoc();
    writeSettings(doc, { language: 'es', theme: 'dark' });
    expect(docToTimeline(doc).settings).toEqual({ language: 'es', theme: 'dark' });

    writeSettings(doc, { language: 'es' });
    expect(docToTimeline(doc).settings).toEqual({ language: 'es' });
  });

  it('round-trips meta and omits what was never set', () => {
    const doc = createDoc();
    writeMeta(doc, { title: 'Spaceflight', titleSetByUser: true });
    expect(readMeta(doc)).toEqual({ title: 'Spaceflight', titleSetByUser: true });
  });

  it('keeps meta out of the timeline it produces', () => {
    const doc = createDoc();
    loadTimeline(doc, timeline(), { title: 'Spaceflight', atUri: 'at://did:plc:x/c/1' });
    expect(docToTimeline(doc)).not.toHaveProperty('atUri');
    expect(readMeta(doc).atUri).toBe('at://did:plc:x/c/1');
  });
});

describe('loading over an existing document', () => {
  it('replaces rather than merges', () => {
    const doc = createDoc();
    loadTimeline(doc, timeline());
    loadTimeline(doc, { events: [sputnik], settings: {} });

    expect(hasTitleSlide(doc)).toBe(false);
    expect(docToTimeline(doc).events).toEqual([sputnik]);
    expect(titleMap(doc).size).toBe(0);
  });
});

describe('real adapter output', () => {
  it('round-trips a timeline imported from TimelineJS 3', () => {
    // Worth testing against the adapter rather than only hand-built objects:
    // it is what actually produces the slides people load, and it exercises
    // assignSlideIds, nested dates and media in one pass.
    const imported = fromTL3({
      title: {
        text: { headline: 'A History of Spaceflight', text: '<p>From Sputnik onward.</p>' },
        background: { color: '#101820' },
      },
      events: [
        {
          start_date: { year: '1957', month: '10', day: '4' },
          end_date: { year: '1958', month: '1', day: '4' },
          text: { headline: 'Sputnik 1', text: '<p>The first artificial satellite.</p>' },
          media: { url: 'https://example.com/sputnik.jpg', caption: 'Sputnik 1', credit: 'TASS' },
          group: 'Space race',
        },
        {
          start_date: { year: '1969', month: '7', day: '20' },
          text: { headline: 'The Moon Landing' },
          media: { url: 'https://example.com/moon.jpg' },
        },
      ],
    });

    const doc = createDoc();
    loadTimeline(doc, imported);

    expect(docToTimeline(doc)).toEqual({
      title: imported.title,
      events: imported.events,
      settings: imported.settings ?? {},
    });
  });
});
