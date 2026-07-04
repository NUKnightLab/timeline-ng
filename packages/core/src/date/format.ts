import type { TLDateInput, TLParsedDate } from '../types.ts';

export type DateFormatPrecision = 'year' | 'month' | 'day' | 'time';

/** Infer formatting precision from which fields are populated. */
function precision(d: TLDateInput): DateFormatPrecision {
  if (d.hour !== undefined) return 'time';
  if (d.day !== undefined) return 'day';
  if (d.month !== undefined) return 'month';
  return 'year';
}

const INTL_OPTIONS: Record<DateFormatPrecision, Intl.DateTimeFormatOptions> = {
  year: { year: 'numeric', timeZone: 'UTC' },
  month: { year: 'numeric', month: 'long', timeZone: 'UTC' },
  day: { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' },
  time: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  },
};

/**
 * Format a cosmological year as a human-readable string.
 * Returns strings like "13,800,000,000 BCE" or "65,000,000 BCE".
 */
function formatCosmologicalYear(year: number, locale: string): string {
  const abs = Math.abs(year);
  const formatted = new Intl.NumberFormat(locale).format(abs);
  return year < 0 ? `${formatted} BCE` : `${formatted} CE`;
}

/**
 * Format a TLParsedDate for display.
 * If `input.display_date` is set, it is returned unchanged.
 */
export function formatDate(
  parsed: TLParsedDate,
  locale = 'en',
  overridePrecision?: DateFormatPrecision,
): string {
  const { input } = parsed;

  if (input.display_date) return input.display_date;

  if (parsed.scale === 'cosmological') {
    return formatCosmologicalYear(input.year, locale);
  }

  const prec = overridePrecision ?? precision(input);
  const dt = new Date(parsed.ms);
  return new Intl.DateTimeFormat(locale, INTL_OPTIONS[prec]).format(dt);
}
