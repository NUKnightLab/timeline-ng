import type { TLDateInput, TLParsedDate, DateScale } from '../types.ts';

// Matches TL3's HUMAN_SCALE_MIN_YEAR / HUMAN_SCALE_MAX_YEAR
const HUMAN_MIN_YEAR = -99999;
const HUMAN_MAX_YEAR = 275759;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function detectScale(year: number): DateScale {
  return year >= HUMAN_MIN_YEAR && year <= HUMAN_MAX_YEAR
    ? 'human'
    : 'cosmological';
}

/**
 * Convert a TLDateInput to a JS Date millisecond value.
 * Months are 1-based in TLDateInput; JS Date expects 0-based months.
 * For BCE years (negative), we use Date.UTC with the two-digit-year caveat
 * avoided by calling setFullYear after construction.
 */
function toJsMs(d: TLDateInput): number {
  // Build via setFullYear to avoid the 0–99 CE ambiguity in Date constructors
  const dt = new Date(0);
  dt.setUTCFullYear(
    d.year,
    d.month !== undefined ? d.month - 1 : 0,
    d.day ?? 1,
  );
  dt.setUTCHours(
    d.hour ?? 0,
    d.minute ?? 0,
    d.second ?? 0,
    d.millisecond ?? 0,
  );
  return dt.getTime();
}

/**
 * For cosmological dates, produce a BigInt "year-millisecond" value
 * suitable only for ordering. We use year * MS_PER_YEAR (as BigInt)
 * to keep the comparison unit consistent with human-scale ms values.
 */
function toCosmoBigMs(year: number): bigint {
  return BigInt(Math.round(year * MS_PER_YEAR));
}

export function parseTLDate(input: TLDateInput): TLParsedDate {
  const scale = detectScale(input.year);

  if (scale === 'human') {
    return { input, scale, ms: toJsMs(input) };
  }

  const bigMs = toCosmoBigMs(input.year);
  // ms is an approximation for cosmological dates — use bigMs for ordering
  const ms = Number(bigMs);
  return { input, scale, ms, bigMs };
}
