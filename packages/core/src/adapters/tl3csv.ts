import type { TLTimeline, TLEvent, TLDateInput } from '../types.ts';

// ── CSV parser (RFC 4180, handles quoted fields with embedded commas/newlines) ──

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  // Normalize line endings
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n') {
        row.push(field.trim());
        field = '';
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  row.push(field.trim());
  if (row.some(c => c !== '')) rows.push(row);
  return rows;
}

// ── Header detection ──────────────────────────────────────────────────────────

function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const lower = rows[i].map(h => h.toLowerCase());
    if (lower.includes('year') && lower.includes('headline')) return i;
  }
  return -1;
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function get(row: string[], idx: number): string {
  return idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : '';
}

function toNum(s: string): number | undefined {
  if (!s) return undefined;
  const n = Number(s);
  return isNaN(n) ? undefined : n;
}

function parseTime(s: string): { hour?: number; minute?: number; second?: number } {
  if (!s) return {};
  const parts = s.split(':').map(p => parseInt(p, 10));
  return {
    ...(isFinite(parts[0]) ? { hour:   parts[0] } : {}),
    ...(isFinite(parts[1]) ? { minute: parts[1] } : {}),
    ...(isFinite(parts[2]) ? { second: parts[2] } : {}),
  };
}

function buildDate(
  row: string[],
  yi: number, mi: number, di: number, ti: number,
  displayDate?: string,
): TLDateInput | undefined {
  const year = toNum(get(row, yi));
  if (year === undefined) return undefined;
  const time = ti >= 0 ? parseTime(get(row, ti)) : {};
  return {
    year,
    ...(toNum(get(row, mi)) !== undefined ? { month:  toNum(get(row, mi)) } : {}),
    ...(toNum(get(row, di)) !== undefined ? { day:    toNum(get(row, di)) } : {}),
    ...time,
    ...(displayDate ? { display_date: displayDate } : {}),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a TimelineJS 3 CSV export (the same format used by the Google Sheets
 * template) into a TLTimeline. Row with Type="title" becomes timeline.title.
 */
export function fromTL3CSV(csvText: string): TLTimeline {
  const rows = parseCSV(csvText);
  const hi = findHeaderRow(rows);
  if (hi < 0) return { events: [] };

  const headers = rows[hi].map(h => h.toLowerCase().trim());
  const col = (name: string) => headers.indexOf(name);

  const iYear    = col('year');
  const iMonth   = col('month');
  const iDay     = col('day');
  const iTime    = col('time');
  const iEndYear = col('end year');
  const iEndMon  = col('end month');
  const iEndDay  = col('end day');
  const iEndTime = col('end time');
  const iDispDate = col('display date');
  const iHead    = col('headline');
  const iText    = col('text');
  const iMedia   = col('media');
  const iCredit  = col('media credit');
  const iCaption = col('media caption');
  const iThumb   = col('media thumbnail');
  const iType    = col('type');
  const iGroup   = col('group');
  const iBg      = col('background');

  let idCounter = 0;
  let titleEvent: TLEvent | undefined;
  const events: TLEvent[] = [];

  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const type = get(row, iType).toLowerCase();
    const isTitle = type === 'title' || type === 'start';

    const displayDate = get(row, iDispDate);
    const startDate = buildDate(row, iYear, iMonth, iDay, iTime, displayDate || undefined);
    const endDate   = buildDate(row, iEndYear, iEndMon, iEndDay, iEndTime);

    if (!isTitle && !startDate) continue;

    const headline = get(row, iHead);
    const body     = get(row, iText);
    const mediaUrl = get(row, iMedia);
    const bg       = get(row, iBg);

    const event: TLEvent = {
      unique_id: String(++idCounter),
      ...(startDate ? { start_date: startDate } : {}),
      ...(endDate   ? { end_date: endDate }     : {}),
      ...(headline || body
        ? { text: { ...(headline ? { headline } : {}), ...(body ? { text: body } : {}) } }
        : {}),
      ...(mediaUrl ? { media: {
        url: mediaUrl,
        ...(get(row, iCredit)  ? { credit:    get(row, iCredit)  } : {}),
        ...(get(row, iCaption) ? { caption:   get(row, iCaption) } : {}),
        ...(get(row, iThumb)   ? { thumbnail: get(row, iThumb)   } : {}),
      }} : {}),
      ...(get(row, iGroup) ? { group: get(row, iGroup) } : {}),
      ...(bg ? {
        background: /^(#|rgba?|hsl|[a-zA-Z]+$)/.test(bg)
          ? { color: bg }
          : { url: bg },
      } : {}),
    };

    if (isTitle) { titleEvent ??= event; }
    else         { events.push(event); }
  }

  return { ...(titleEvent ? { title: titleEvent } : {}), events };
}
