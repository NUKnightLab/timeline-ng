import type { TLParsedDate } from '../types.ts';

/**
 * Compare two parsed dates for ordering.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Handles mixed human/cosmological scale by falling back to bigMs.
 */
export function compareDates(a: TLParsedDate, b: TLParsedDate): number {
  if (a.bigMs !== undefined || b.bigMs !== undefined) {
    const aVal = a.bigMs ?? BigInt(Math.round(a.ms));
    const bVal = b.bigMs ?? BigInt(Math.round(b.ms));
    return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
  }
  return a.ms - b.ms;
}
