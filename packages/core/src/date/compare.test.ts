import { describe, it, expect } from 'vitest';
import { compareDates } from './compare.ts';
import { parseTLDate } from './parse.ts';

describe('compareDates', () => {
  it('orders human-scale dates chronologically', () => {
    const a = parseTLDate({ year: 1900 });
    const b = parseTLDate({ year: 2000 });
    expect(compareDates(a, b)).toBeLessThan(0);
    expect(compareDates(b, a)).toBeGreaterThan(0);
    expect(compareDates(a, a)).toBe(0);
  });

  it('orders BCE before CE', () => {
    const bce = parseTLDate({ year: -500 });
    const ce = parseTLDate({ year: 500 });
    expect(compareDates(bce, ce)).toBeLessThan(0);
  });

  it('orders cosmological dates', () => {
    const bigBang = parseTLDate({ year: -13_800_000_000 });
    const dinosaurs = parseTLDate({ year: -65_000_000 });
    const now = parseTLDate({ year: 2024 });
    expect(compareDates(bigBang, dinosaurs)).toBeLessThan(0);
    expect(compareDates(dinosaurs, now)).toBeLessThan(0);
    expect(compareDates(bigBang, now)).toBeLessThan(0);
  });

  it('can compare mixed human and cosmological dates', () => {
    const cosmo = parseTLDate({ year: -200_000 }); // before human range
    const human = parseTLDate({ year: -99999 }); // edge of human range
    expect(compareDates(cosmo, human)).toBeLessThan(0);
  });
});
