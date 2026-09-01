import { describe, it, expect } from 'vitest';
import { slugifySlideId, isValidSlideId, uniqueSlideId, assignSlideIds } from './ids.ts';
import type { TLTimeline } from '../types.ts';

describe('slugifySlideId', () => {
  it('slugs a headline', () => {
    expect(slugifySlideId('The Moon Landing')).toBe('the-moon-landing');
  });

  it('strips HTML and punctuation', () => {
    expect(slugifySlideId('<b>Apollo 11:</b> "one small step"')).toBe('apollo-11-one-small-step');
  });

  it('folds accents rather than dropping the word', () => {
    expect(slugifySlideId('Año Nuevo en México')).toBe('ano-nuevo-en-mexico');
  });

  it('keeps a leading number by prefixing instead of truncating', () => {
    expect(slugifySlideId('1969 Moon Landing')).toBe('slide-1969-moon-landing');
  });

  it('returns empty when nothing usable survives', () => {
    expect(slugifySlideId('???')).toBe('');
    expect(slugifySlideId('東京')).toBe('');
  });

  it('produces legal ids', () => {
    for (const h of ['The Moon Landing', '1969 Moon Landing', '<b>Apollo 11:</b>']) {
      expect(isValidSlideId(slugifySlideId(h))).toBe(true);
    }
  });
});

describe('assignSlideIds', () => {
  it('builds ids from headlines', () => {
    const tl: TLTimeline = {
      events: [
        { start_date: { year: 2000 }, text: { headline: 'First Thing' } },
        { start_date: { year: 2001 }, text: { headline: 'Second Thing' } },
      ],
    };
    assignSlideIds(tl);
    expect(tl.events.map(e => e.unique_id)).toEqual(['first-thing', 'second-thing']);
  });

  it('replaces illegal ids, including the numeric ones legacy imports produced', () => {
    const tl: TLTimeline = {
      events: [
        { start_date: { year: 2000 }, unique_id: '1', text: { headline: 'First Thing' } },
        { start_date: { year: 2001 }, unique_id: '2', text: { headline: 'Second Thing' } },
      ],
    };
    assignSlideIds(tl);
    expect(tl.events.map(e => e.unique_id)).toEqual(['first-thing', 'second-thing']);
  });

  it('keeps ids that are already legal', () => {
    const tl: TLTimeline = {
      events: [{ start_date: { year: 2000 }, unique_id: 'my-slide', text: { headline: 'First Thing' } }],
    };
    assignSlideIds(tl);
    expect(tl.events[0].unique_id).toBe('my-slide');
  });

  it('names the title slide "title"', () => {
    const tl: TLTimeline = { title: { unique_id: '1', text: { headline: 'My Timeline' } }, events: [] };
    assignSlideIds(tl);
    expect(tl.title?.unique_id).toBe('title');
  });

  it('disambiguates repeated headlines', () => {
    const tl: TLTimeline = {
      events: [
        { start_date: { year: 2000 }, text: { headline: 'Same' } },
        { start_date: { year: 2001 }, text: { headline: 'Same' } },
        { start_date: { year: 2002 }, text: { headline: 'Same' } },
      ],
    };
    assignSlideIds(tl);
    expect(tl.events.map(e => e.unique_id)).toEqual(['same', 'same-2', 'same-3']);
  });

  it('does not let a regenerated id collide with a preserved one', () => {
    const tl: TLTimeline = {
      events: [
        { start_date: { year: 2000 }, unique_id: '1', text: { headline: 'Same' } },
        { start_date: { year: 2001 }, unique_id: 'same', text: { headline: 'Same' } },
      ],
    };
    assignSlideIds(tl);
    expect(tl.events.map(e => e.unique_id)).toEqual(['same-2', 'same']);
  });

  it('falls back to a positional id when a headline yields nothing', () => {
    const tl: TLTimeline = {
      events: [
        { start_date: { year: 2000 } },
        { start_date: { year: 2001 }, text: { headline: '東京' } },
      ],
    };
    assignSlideIds(tl);
    expect(tl.events.map(e => e.unique_id)).toEqual(['slide-1', 'slide-2']);
    for (const e of tl.events) expect(isValidSlideId(e.unique_id!)).toBe(true);
  });

  it('gives every event an id even with duplicate illegal ids in the source', () => {
    const tl: TLTimeline = {
      events: [
        { start_date: { year: 2000 }, unique_id: 'dup', text: { headline: 'A' } },
        { start_date: { year: 2001 }, unique_id: 'dup', text: { headline: 'B' } },
      ],
    };
    assignSlideIds(tl);
    expect(tl.events.map(e => e.unique_id)).toEqual(['dup', 'b']);
  });
});

describe('uniqueSlideId', () => {
  it('returns the base when it is free', () => {
    expect(uniqueSlideId('intro', new Set(['other']))).toBe('intro');
  });

  it('suffixes past every taken variant', () => {
    expect(uniqueSlideId('intro', new Set(['intro', 'intro-2']))).toBe('intro-3');
  });

  it('does not mutate the set it is given', () => {
    const taken = new Set(['intro']);
    uniqueSlideId('intro', taken);
    expect([...taken]).toEqual(['intro']);
  });
});

describe('slugifySlideId with entities', () => {
  it('drops HTML entities rather than spelling them out', () => {
    expect(slugifySlideId('Rock &amp; Roll')).toBe('rock-roll');
  });
});
