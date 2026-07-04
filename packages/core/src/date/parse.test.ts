import { describe, it, expect } from 'vitest';
import { parseTLDate, detectScale } from './parse.ts';

describe('detectScale', () => {
  it('returns human for years within range', () => {
    expect(detectScale(2024)).toBe('human');
    expect(detectScale(0)).toBe('human');
    expect(detectScale(-99999)).toBe('human');
    expect(detectScale(275759)).toBe('human');
  });

  it('returns cosmological for years outside range', () => {
    expect(detectScale(-100000)).toBe('cosmological');
    expect(detectScale(275760)).toBe('cosmological');
    expect(detectScale(-13_800_000_000)).toBe('cosmological');
  });
});

describe('parseTLDate', () => {
  it('parses a year-only date', () => {
    const parsed = parseTLDate({ year: 1969 });
    expect(parsed.scale).toBe('human');
    const d = new Date(parsed.ms);
    expect(d.getUTCFullYear()).toBe(1969);
  });

  it('parses a full date', () => {
    const parsed = parseTLDate({ year: 1969, month: 7, day: 20 });
    const d = new Date(parsed.ms);
    expect(d.getUTCFullYear()).toBe(1969);
    expect(d.getUTCMonth()).toBe(6); // 0-based
    expect(d.getUTCDate()).toBe(20);
  });

  it('parses a BCE date (negative year)', () => {
    const parsed = parseTLDate({ year: -44 }); // Julius Caesar assassinated
    expect(parsed.scale).toBe('human');
    const d = new Date(parsed.ms);
    expect(d.getUTCFullYear()).toBe(-44);
  });

  it('returns cosmological scale for big bang', () => {
    const parsed = parseTLDate({ year: -13_800_000_000 });
    expect(parsed.scale).toBe('cosmological');
    expect(parsed.bigMs).toBeDefined();
  });

  it('preserves display_date', () => {
    const parsed = parseTLDate({ year: 2000, display_date: 'The Millennium' });
    expect(parsed.input.display_date).toBe('The Millennium');
  });

  it('handles month as 1-based correctly', () => {
    // month 1 = January = UTC month 0
    const jan = parseTLDate({ year: 2024, month: 1, day: 1 });
    expect(new Date(jan.ms).getUTCMonth()).toBe(0);

    const dec = parseTLDate({ year: 2024, month: 12, day: 1 });
    expect(new Date(dec.ms).getUTCMonth()).toBe(11);
  });
});
