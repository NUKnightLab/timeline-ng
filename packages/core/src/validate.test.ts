import { describe, it, expect } from 'vitest';
import { validateTimeline } from './validate.ts';

describe('validateTimeline', () => {
  it('accepts a minimal valid timeline', () => {
    const result = validateTimeline({
      events: [{ start_date: { year: 2024 } }],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-object input', () => {
    expect(validateTimeline(null).valid).toBe(false);
    expect(validateTimeline('string').valid).toBe(false);
    expect(validateTimeline(42).valid).toBe(false);
  });

  it('rejects missing events array', () => {
    const result = validateTimeline({});
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'events')).toBe(true);
  });

  it('rejects event without start_date', () => {
    const result = validateTimeline({ events: [{ text: { headline: 'No date' } }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path.includes('start_date'))).toBe(true);
  });

  it('rejects start_date without year', () => {
    const result = validateTimeline({ events: [{ start_date: { month: 3 } }] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path.includes('year'))).toBe(true);
  });

  it('rejects invalid month value', () => {
    const result = validateTimeline({ events: [{ start_date: { year: 2024, month: 13 } }] });
    expect(result.valid).toBe(false);
  });

  it('accepts title without start_date', () => {
    const result = validateTimeline({
      title: { text: { headline: 'My Timeline' } },
      events: [{ start_date: { year: 2024 } }],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts events with optional fields', () => {
    const result = validateTimeline({
      events: [{
        start_date: { year: 2024, month: 1, day: 1 },
        end_date: { year: 2024, month: 12, day: 31 },
        text: { headline: 'A year', text: '<p>The whole year</p>' },
        media: { url: 'https://example.com/img.jpg', caption: 'An image' },
        group: 'Events',
        background: { color: '#ff0000' },
      }],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects media without url', () => {
    const result = validateTimeline({
      events: [{ start_date: { year: 2024 }, media: { caption: 'no url' } }],
    });
    expect(result.valid).toBe(false);
  });

  it('accepts valid settings', () => {
    const result = validateTimeline({
      events: [],
      settings: { language: 'es', theme: 'dark', initialIndex: 2, reverseOrder: true },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid theme value', () => {
    const result = validateTimeline({ events: [], settings: { theme: 'purple' } });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'settings.theme')).toBe(true);
  });

  it('rejects a non-boolean reverseOrder', () => {
    const result = validateTimeline({ events: [], settings: { reverseOrder: 'yes' } });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'settings.reverseOrder')).toBe(true);
  });

  it('rejects a negative initialIndex', () => {
    const result = validateTimeline({ events: [], settings: { initialIndex: -1 } });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'settings.initialIndex')).toBe(true);
  });
});
