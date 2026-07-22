import { fromTL3 } from './tl3.ts';
import { fromTL3CSV } from './tl3csv.ts';
import type { TLTimeline } from '../types.ts';

const SHEETS_PUBHTML = /docs\.google\.com\/spreadsheets\/d\/e\/([^/]+)\/pubhtml/;

/**
 * Rewrite a Google Sheets "publish to the web" link (the `.../pubhtml` URL
 * Sheets hands you) into the CSV export endpoint that can actually be
 * fetched. Non-Sheets URLs are returned unchanged.
 */
export function normalizeTimelineSourceUrl(url: string): string {
  const m = url.match(SHEETS_PUBHTML);
  if (!m) return url;
  return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv`;
}

/**
 * Parse fetched timeline text as CSV (the TL3/Sheets export format) or JSON
 * (TL3 or native TLTimeline), sniffing which one it is from the content.
 */
export function parseTimelineText(text: string): TLTimeline {
  const trimmed = text.trimStart();
  const looksLikeCsv = trimmed.startsWith('"') || (!trimmed.startsWith('{') && !trimmed.startsWith('['));
  return looksLikeCsv ? fromTL3CSV(text) : fromTL3(JSON.parse(text));
}
