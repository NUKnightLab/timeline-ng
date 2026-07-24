import { describe, it, expect } from 'vitest';
import { fromTL3CSV, toTL3CSV } from './tl3csv.ts';
import type { TLTimeline } from '../types.ts';

describe('toTL3CSV', () => {
  it('round-trips through fromTL3CSV', () => {
    const timeline: TLTimeline = {
      title: { text: { headline: 'My Timeline', text: 'An intro' } },
      events: [
        {
          unique_id: '1',
          start_date: { year: 2020, month: 1, day: 2, hour: 14, minute: 30, display_date: 'Early 2020' },
          end_date: { year: 2020, month: 3, day: 4 },
          text: { headline: 'Event, with a comma', text: 'Body text with a "quote"' },
          media: { url: 'https://example.com/img.jpg', credit: 'Credit', caption: 'Caption', thumbnail: 'https://example.com/thumb.jpg' },
          group: 'Group A',
          background: { color: '#fff' },
        },
        {
          unique_id: '2',
          start_date: { year: 1500 },
          background: { url: 'https://example.com/bg.jpg' },
        },
      ],
    };

    const csv = toTL3CSV(timeline);
    const roundTripped = fromTL3CSV(csv);

    expect(roundTripped.title?.text?.headline).toBe('My Timeline');
    expect(roundTripped.title?.text?.text).toBe('An intro');
    expect(roundTripped.events).toHaveLength(2);

    const [e1, e2] = roundTripped.events;
    expect(e1.start_date).toEqual({ year: 2020, month: 1, day: 2, hour: 14, minute: 30, display_date: 'Early 2020' });
    expect(e1.end_date).toEqual({ year: 2020, month: 3, day: 4 });
    expect(e1.text?.headline).toBe('Event, with a comma');
    expect(e1.text?.text).toBe('Body text with a "quote"');
    expect(e1.media?.url).toBe('https://example.com/img.jpg');
    expect(e1.media?.credit).toBe('Credit');
    expect(e1.media?.caption).toBe('Caption');
    expect(e1.media?.thumbnail).toBe('https://example.com/thumb.jpg');
    expect(e1.group).toBe('Group A');
    expect(e1.background?.color).toBe('#fff');

    expect(e2.start_date).toEqual({ year: 1500 });
    expect(e2.background?.url).toBe('https://example.com/bg.jpg');
  });

  it('omits a title row when there is no title event', () => {
    const csv = toTL3CSV({ events: [{ start_date: { year: 2000 }, text: { headline: 'Only event' } }] });
    const roundTripped = fromTL3CSV(csv);
    expect(roundTripped.title).toBeUndefined();
    expect(roundTripped.events).toHaveLength(1);
  });
});
