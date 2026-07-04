import type {
  TLTimeline,
  TLEvent,
  TLDateInput,
  TLMedia,
  TLText,
  TLBackground,
} from '../types.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

function toStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return undefined;
}

function adaptDate(d: unknown): TLDateInput | undefined {
  if (typeof d !== 'object' || d === null) return undefined;
  const obj = d as Record<string, unknown>;
  const year = toNum(obj['year']);
  if (year === undefined) return undefined;
  return {
    year,
    month: toNum(obj['month']),
    day: toNum(obj['day']),
    hour: toNum(obj['hour']),
    minute: toNum(obj['minute']),
    second: toNum(obj['second']),
    millisecond: toNum(obj['millisecond']),
    display_date: toStr(obj['display_date']),
  };
}

function adaptMedia(m: unknown): TLMedia | undefined {
  if (typeof m !== 'object' || m === null) return undefined;
  const obj = m as Record<string, unknown>;
  const url = toStr(obj['url']);
  if (!url) return undefined;
  return {
    url,
    caption: toStr(obj['caption']),
    credit: toStr(obj['credit']),
    thumbnail: toStr(obj['thumbnail']),
    alt: toStr(obj['alt']),
  };
}

function adaptText(t: unknown): TLText | undefined {
  if (typeof t !== 'object' || t === null) return undefined;
  const obj = t as Record<string, unknown>;
  const headline = toStr(obj['headline']);
  const text = toStr(obj['text']);
  if (!headline && !text) return undefined;
  return { headline, text };
}

function adaptBackground(b: unknown): TLBackground | undefined {
  if (typeof b !== 'object' || b === null) return undefined;
  const obj = b as Record<string, unknown>;
  const color = toStr(obj['color']);
  const url = toStr(obj['url']);
  if (!color && !url) return undefined;
  return { color, url };
}

function adaptEvent(e: unknown): TLEvent | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const obj = e as Record<string, unknown>;

  const start_date = adaptDate(obj['start_date']);
  // TL3 title slides may omit start_date
  if (!start_date && 'start_date' in obj) return undefined;

  const event: TLEvent = {};

  // TL3 uses both 'id' and 'unique_id'
  const id = toStr(obj['unique_id']) ?? toStr(obj['id']);
  if (id) event.unique_id = id;

  if (start_date) event.start_date = start_date;

  const end_date = adaptDate(obj['end_date']);
  if (end_date) event.end_date = end_date;

  const text = adaptText(obj['text']);
  if (text) event.text = text;

  const media = adaptMedia(obj['media']);
  if (media) event.media = media;

  const group = toStr(obj['group']);
  if (group) event.group = group;

  const background = adaptBackground(obj['background']);
  if (background) event.background = background;

  return event;
}

/**
 * Convert a TimelineJS3 JSON configuration object to a TLTimeline.
 * Accepts the raw parsed JSON (not a JSON string).
 * Unknown or malformed fields are silently dropped.
 */
export function fromTL3(data: unknown): TLTimeline {
  if (typeof data !== 'object' || data === null) {
    return { events: [] };
  }

  const obj = data as Record<string, unknown>;
  const timeline: TLTimeline = { events: [] };

  if ('title' in obj && obj['title']) {
    const title = adaptEvent(obj['title']);
    if (title) timeline.title = title;
  }

  if (Array.isArray(obj['events'])) {
    for (const raw of obj['events']) {
      const event = adaptEvent(raw);
      if (event?.start_date) {
        timeline.events.push(event);
      }
    }
  }

  return timeline;
}
