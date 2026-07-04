import { describe, it, expect } from 'vitest';
import { formatDate } from './format.ts';
import { parseTLDate } from './parse.ts';

describe('formatDate', () => {
  it('returns display_date if provided', () => {
    const parsed = parseTLDate({ year: 2024, display_date: 'The Future' });
    expect(formatDate(parsed)).toBe('The Future');
  });

  it('formats year-only date', () => {
    const parsed = parseTLDate({ year: 1969 });
    const result = formatDate(parsed, 'en');
    expect(result).toContain('1969');
  });

  it('formats month+year date', () => {
    const parsed = parseTLDate({ year: 1969, month: 7 });
    const result = formatDate(parsed, 'en');
    expect(result).toContain('1969');
    expect(result).toMatch(/July|Jul/);
  });

  it('formats full date', () => {
    const parsed = parseTLDate({ year: 1969, month: 7, day: 20 });
    const result = formatDate(parsed, 'en');
    expect(result).toContain('1969');
    expect(result).toContain('20');
  });

  it('formats cosmological date as years BCE', () => {
    const parsed = parseTLDate({ year: -13_800_000_000 });
    const result = formatDate(parsed, 'en');
    expect(result).toContain('BCE');
    expect(result).toContain('13');
  });

  it('formats a positive cosmological year', () => {
    const parsed = parseTLDate({ year: 500_000 });
    const result = formatDate(parsed, 'en');
    expect(result).toContain('CE');
  });

  it('respects locale for month names', () => {
    const parsed = parseTLDate({ year: 2024, month: 1 });
    const esResult = formatDate(parsed, 'es');
    expect(esResult).toMatch(/enero|Enero/i);
  });
});
