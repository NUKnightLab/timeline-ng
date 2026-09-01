import type { TLEvent, TLTimeline } from '../types.ts';

/**
 * The shape a slide ID has to have: a letter, then letters, digits, `-` or `_`.
 *
 * Slide IDs are meant to be usable as URL fragments and CSS/DOM identifiers,
 * so the rule is deliberately narrower than "any non-empty string".
 */
export const SLIDE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function isValidSlideId(id: string): boolean {
  return SLIDE_ID_PATTERN.test(id);
}

/** Slugs longer than this get cut — long enough to stay readable, short enough to type. */
const MAX_SLUG_LENGTH = 48;

/**
 * Turn arbitrary headline text into the longest legal ID it can support.
 * Returns '' when nothing usable survives (a headline that is entirely
 * punctuation, or entirely in a script with no ASCII transliteration).
 */
export function slugifySlideId(text: string): string {
  const slug = text
    .replace(/<[^>]*>/g, ' ')          // headlines may carry HTML
    .replace(/&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);/g, ' ')  // …and entities
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')       // é → e, ñ → n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');
  if (!slug) return '';
  // A leading digit is illegal, but dropping it would lose real information
  // ("1969 Moon Landing"), so prefix instead of truncate.
  return /^[a-z]/.test(slug) ? slug : `slide-${slug}`;
}

/**
 * `base` if it is free, else `base-2`, `base-3`, … until one is.
 * Non-mutating, so callers that only need to *offer* an ID (the editor's
 * "generate from the headline" affordance) can use it too.
 */
export function uniqueSlideId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Claim `base` in `taken`, appending -2, -3, … until it is free. */
function claim(base: string, taken: Set<string>): string {
  const id = uniqueSlideId(base, taken);
  taken.add(id);
  return id;
}

/**
 * Give every event in an imported timeline a legal, unique slide ID, in place.
 *
 * IDs already present in the source are kept when they are legal and unique —
 * an author who set `unique_id` deliberately, or a timeline-ng file being read
 * back in, should round-trip unchanged. Everything else is regenerated from the
 * headline, which is what makes an imported timeline's IDs worth looking at:
 * TimelineJS 3's spreadsheet format has no ID column at all, so a sheet import
 * would otherwise arrive as 1..N, which is both meaningless and illegal.
 */
export function assignSlideIds(timeline: TLTimeline): void {
  const all: TLEvent[] = timeline.title ? [timeline.title, ...timeline.events] : timeline.events;
  const taken = new Set<string>();

  for (const event of all) {
    const id = event.unique_id;
    if (id && isValidSlideId(id) && !taken.has(id)) taken.add(id);
    else delete event.unique_id;
  }

  all.forEach((event, i) => {
    if (event.unique_id) return;
    const isTitle = event === timeline.title;
    const base = (isTitle ? 'title' : slugifySlideId(event.text?.headline ?? '')) || `slide-${i + 1}`;
    event.unique_id = claim(base, taken);
  });
}
