import { describe, it, expect } from 'vitest';
import { fromTL3 } from './tl3.ts';

const TL3_SAMPLE = {
  title: {
    media: {
      url: 'https://example.com/img.jpg',
      caption: 'A caption',
      credit: 'Author',
    },
    text: {
      headline: 'My Timeline',
      text: '<p>An intro</p>',
    },
  },
  events: [
    {
      id: 'event-1',
      start_date: { year: '1969', month: '7', day: '20' },
      text: { headline: 'Moon Landing', text: '<p>Apollo 11</p>' },
      media: { url: 'https://youtube.com/watch?v=test', caption: 'Mission footage' },
    },
    {
      unique_id: 'event-2',
      start_date: { year: '1989' },
      end_date: { year: '1991' },
      text: { headline: 'Cold War ends', text: '' },
      group: 'History',
      background: { color: '#cccccc' },
    },
  ],
};

describe('fromTL3', () => {
  it('returns empty timeline for non-object input', () => {
    expect(fromTL3(null)).toEqual({ events: [] });
    expect(fromTL3('string')).toEqual({ events: [] });
  });

  it('converts a title slide', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.title).toBeDefined();
    expect(tl.title?.text?.headline).toBe('My Timeline');
    expect(tl.title?.media?.url).toBe('https://example.com/img.jpg');
    expect(tl.title?.media?.credit).toBe('Author');
  });

  it('converts events array', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.events).toHaveLength(2);
  });

  it('converts string year values to numbers', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.events[0].start_date?.year).toBe(1969);
    expect(tl.events[0].start_date?.month).toBe(7);
    expect(tl.events[0].start_date?.day).toBe(20);
  });

  it('maps id to unique_id', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.events[0].unique_id).toBe('event-1');
  });

  it('prefers unique_id over id', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.events[1].unique_id).toBe('event-2');
  });

  it('converts end_date', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.events[1].end_date?.year).toBe(1991);
  });

  it('converts group and background', () => {
    const tl = fromTL3(TL3_SAMPLE);
    expect(tl.events[1].group).toBe('History');
    expect(tl.events[1].background?.color).toBe('#cccccc');
  });

  it('drops events with no start_date', () => {
    const data = { events: [{ text: { headline: 'No date' } }] };
    const tl = fromTL3(data);
    expect(tl.events).toHaveLength(0);
  });

  it('handles empty text body gracefully', () => {
    const tl = fromTL3(TL3_SAMPLE);
    // event-2 has empty text string — headline still preserved
    expect(tl.events[1].text?.headline).toBe('Cold War ends');
  });
});
