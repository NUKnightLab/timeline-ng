import { describe, it, expect } from 'vitest';
import { normalizeTimelineSourceUrl, parseTimelineText } from './url-import.ts';

describe('normalizeTimelineSourceUrl', () => {
  it('rewrites a Sheets pubhtml URL to the CSV export endpoint', () => {
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-abc123/pubhtml';
    expect(normalizeTimelineSourceUrl(url)).toBe(
      'https://docs.google.com/spreadsheets/d/e/2PACX-abc123/pub?output=csv',
    );
  });

  it('leaves non-Sheets URLs unchanged', () => {
    const url = 'https://example.com/timeline.json';
    expect(normalizeTimelineSourceUrl(url)).toBe(url);
  });
});

describe('parseTimelineText', () => {
  it('parses quoted CSV as a TL3 CSV export', () => {
    const csv = '"Year","Headline"\n"2020","Hello"\n';
    const tl = parseTimelineText(csv);
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0].text?.headline).toBe('Hello');
  });

  it('parses a JSON object as a TL3 timeline', () => {
    const json = JSON.stringify({ events: [{ start_date: { year: 2020 }, text: { headline: 'Hi' } }] });
    const tl = parseTimelineText(json);
    expect(tl.events).toHaveLength(1);
    expect(tl.events[0].text?.headline).toBe('Hi');
  });
});
