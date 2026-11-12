/**
 * The inside of a pull-list row: which fields two versions of one slide
 * disagree about, how to show each one, and how to take a single one —
 * [P6] in `docs/phase1-sync-conflicts.md`.
 *
 * A row that only says "Changed in your copy" cannot be evaluated. The two
 * documents are both the author's and often differ in one word, so the real
 * question is not "do I want this slide?" but "do I want *this* headline" —
 * which needs both values on screen next to each other.
 *
 * Fields are listed explicitly rather than walked off the object, for two
 * reasons. `text` and `media` hold several author-facing fields each, so the
 * data model's own keys are the wrong granularity: taking `text` would carry
 * the body along with the headline. And a field nobody can see — a derived
 * media URL, say — must not become a row offering a choice between two values
 * that mean the same thing.
 *
 * Every take is non-mutating and returns a whole slide, because that is what
 * `replaceEvent` writes: one `USER_ORIGIN` transaction, so one Cmd-Z, exactly
 * like taking the whole row.
 */
import { formatDate, parseTLDate } from '@knight-lab/timeline-ng-core';
import type { TLEvent, TLSettings } from '@knight-lab/timeline-ng-core';
import { sameValue } from './doc.ts';
import { comparable } from './threeWay.ts';

export interface FieldDiff {
  /** Identifies the row, and names the field to `takeField`. */
  key: string;
  /** What the editor calls this field. */
  label: string;
  /** The working document's value, rendered for reading. */
  here: string;
  /** The fork's value, rendered for reading. */
  theirs: string;
  /**
   * Too long to sit on one line beside its counterpart, so the panel stacks
   * it instead of putting the two side by side.
   */
  long: boolean;
}

/** Nothing there — shown rather than left blank, so an empty side is legible as a choice. */
const EMPTY = '—';

/** Markup out, whitespace collapsed: these are values to read, not to render. */
function plain(html: string | undefined): string {
  const text = (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || EMPTY;
}

function date(value: TLEvent['start_date']): string {
  if (!value) return EMPTY;
  try {
    return formatDate(parseTLDate(value)) || EMPTY;
  } catch {
    // A date the parser rejects is still a difference worth showing, and the
    // panel is the wrong place to discover that it cannot be parsed.
    return JSON.stringify(value);
  }
}

/**
 * Which image, said in a way that distinguishes two of them.
 *
 * A blob is named by the tail of its CID: not beautiful, but it is the only
 * thing that tells two uploads apart, and a thumbnail here would mean
 * resolving the fork's blobs against the PDS — work the panel does not do.
 */
function image(media: { url?: string; blobRef?: unknown } | undefined): string {
  if (!media) return EMPTY;
  const ref = media.blobRef as { ref?: { $link?: string } } | undefined;
  const cid = ref?.ref?.$link;
  if (cid) return `uploaded image …${cid.slice(-8)}`;
  if (media.url) {
    const tail = media.url.split('/').filter(Boolean).at(-1);
    return tail || media.url;
  }
  return EMPTY;
}

interface FieldSpec {
  key: string;
  label: string;
  /** The value that decides whether the two sides differ. */
  read: (ev: TLEvent) => unknown;
  show: (ev: TLEvent) => string;
  /** A copy of `into` holding this field from `from`. */
  take: (into: TLEvent, from: TLEvent) => TLEvent;
  long?: boolean;
}

/** Merge one key of a nested object, dropping it when the source has none. */
function withNested<K extends 'text' | 'media' | 'background'>(
  into: TLEvent,
  from: TLEvent,
  outer: K,
  key: string,
): TLEvent {
  const current = { ...(into[outer] as Record<string, unknown> | undefined) };
  const value = (from[outer] as Record<string, unknown> | undefined)?.[key];
  if (value === undefined) delete current[key];
  else current[key] = value;
  // An object left with no keys is not the same as an empty one: the slide
  // should come out without a `media` at all, the way an unset field looks
  // everywhere else.
  if (Object.keys(current).length === 0) {
    const { [outer]: _gone, ...rest } = into;
    return rest as TLEvent;
  }
  return { ...into, [outer]: current } as TLEvent;
}

/** Merge several keys of a nested object at once — a media source is more than one key. */
function withNestedKeys<K extends 'text' | 'media' | 'background'>(
  into: TLEvent,
  from: TLEvent,
  outer: K,
  keys: string[],
): TLEvent {
  let out = into;
  for (const key of keys) out = withNested(out, from, outer, key);
  return out;
}

const takeTop = (into: TLEvent, from: TLEvent, key: keyof TLEvent): TLEvent => {
  if (from[key] === undefined) {
    const { [key]: _gone, ...rest } = into;
    return rest as TLEvent;
  }
  return { ...into, [key]: from[key] } as TLEvent;
};

/**
 * The fields a row can offer, in the order the editor shows them.
 *
 * `media` is one row covering url, blobRef, mimeType and thumbnail together:
 * they describe a single image, and offering them separately would let
 * someone take a CID without the MIME type that says how to read it.
 */
const FIELDS: FieldSpec[] = [
  {
    key: 'headline',
    label: 'Headline',
    read: (ev) => plain(ev.text?.headline),
    show: (ev) => plain(ev.text?.headline),
    take: (into, from) => withNested(into, from, 'text', 'headline'),
  },
  {
    key: 'body',
    label: 'Body',
    read: (ev) => plain(ev.text?.text),
    show: (ev) => plain(ev.text?.text),
    take: (into, from) => withNested(into, from, 'text', 'text'),
    long: true,
  },
  {
    key: 'start_date',
    label: 'Date',
    read: (ev) => ev.start_date,
    show: (ev) => date(ev.start_date),
    take: (into, from) => takeTop(into, from, 'start_date'),
  },
  {
    key: 'end_date',
    label: 'End date',
    read: (ev) => ev.end_date,
    show: (ev) => date(ev.end_date),
    take: (into, from) => takeTop(into, from, 'end_date'),
  },
  {
    key: 'media',
    label: 'Media',
    // Through `comparable`, which drops the URL derived from a blob: it is
    // recomputed from the CID and the PDS origin on every read, so two sides
    // holding the same upload can disagree about it and mean nothing.
    read: (ev) => {
      const media = comparable(ev).media as Record<string, unknown> | undefined;
      if (!media) return undefined;
      const { url, blobRef, mimeType, thumbnail } = media;
      return { url, blobRef, mimeType, thumbnail };
    },
    show: (ev) => image(ev.media),
    take: (into, from) => withNestedKeys(into, from, 'media', ['url', 'blobRef', 'mimeType', 'thumbnail']),
  },
  {
    key: 'caption',
    label: 'Caption',
    read: (ev) => plain(ev.media?.caption),
    show: (ev) => plain(ev.media?.caption),
    take: (into, from) => withNested(into, from, 'media', 'caption'),
  },
  {
    key: 'credit',
    label: 'Credit',
    read: (ev) => plain(ev.media?.credit),
    show: (ev) => plain(ev.media?.credit),
    take: (into, from) => withNested(into, from, 'media', 'credit'),
  },
  {
    key: 'alt',
    label: 'Alt text',
    read: (ev) => plain(ev.media?.alt),
    show: (ev) => plain(ev.media?.alt),
    take: (into, from) => withNested(into, from, 'media', 'alt'),
  },
  {
    key: 'media_position',
    label: 'Media position',
    read: (ev) => ev.media_position,
    show: (ev) => ev.media_position ?? EMPTY,
    take: (into, from) => takeTop(into, from, 'media_position'),
  },
  {
    key: 'background',
    label: 'Background',
    read: (ev) => comparable(ev).background,
    show: (ev) => ev.background?.color ?? image(ev.background),
    take: (into, from) => takeTop(into, from, 'background'),
  },
  {
    key: 'group',
    label: 'Group',
    read: (ev) => ev.group,
    show: (ev) => ev.group || EMPTY,
    take: (into, from) => takeTop(into, from, 'group'),
  },
  {
    key: 'unique_id',
    label: 'Slide ID',
    read: (ev) => ev.unique_id,
    show: (ev) => ev.unique_id || EMPTY,
    take: (into, from) => takeTop(into, from, 'unique_id'),
  },
];

const byKey = new Map(FIELDS.map((f) => [f.key, f]));

/** Anything longer than this reads better stacked than in a column. */
const WIDE = 48;

/**
 * Every field the two versions disagree about.
 *
 * `here` is the working document's slide, `theirs` the fork's. An absent side
 * yields nothing: an added or removed slide is a whole-row decision, and
 * listing every field of it against nothing would be noise dressed as detail.
 *
 * `base` is the version both diverged from, and giving it narrows the list to
 * fields **the draft itself changed**. Without it a row offered every field
 * that differed, including ones only the published side touched — so a date
 * the author never edited sat there with a *Keep mine* button that would
 * quietly revert someone else's work. It also makes a line answerable both
 * ways: a decline is recorded by moving the ancestor up to the draft's value,
 * which only removes a line if the line is derived from the ancestor.
 */
export function fieldDiffs(
  here: TLEvent | undefined,
  theirs: TLEvent | undefined,
  base?: TLEvent,
): FieldDiff[] {
  if (!here || !theirs) return [];
  const out: FieldDiff[] = [];
  for (const spec of FIELDS) {
    if (sameValue(spec.read(here), spec.read(theirs))) continue;
    // No ancestor — both sides invented this slide under the same id — means
    // every difference is the draft's, since there is nothing it inherited.
    if (base && sameValue(spec.read(base), spec.read(theirs))) continue;
    const a = spec.show(here);
    const b = spec.show(theirs);
    out.push({
      key: spec.key,
      label: spec.label,
      here: a,
      theirs: b,
      long: !!spec.long || a.length > WIDE || b.length > WIDE,
    });
  }
  return out;
}

/** One field of `from` written into a copy of `into`. Unknown keys change nothing. */
export function takeField(into: TLEvent, from: TLEvent, key: string): TLEvent {
  const spec = byKey.get(key);
  return spec ? spec.take(into, from) : into;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTING_LABELS: Record<string, string> = {
  language: 'Language',
  theme: 'Theme',
  fontPairing: 'Fonts',
  highContrast: 'High contrast',
  initialIndex: 'Starting slide',
  reverseOrder: 'Newest first',
};

/**
 * Settings that are never a line, because they are never a choice.
 *
 * `ogImage` is regenerated and re-uploaded on every publish, so neither
 * side's poster outlives the next one — see `comparableSettings`, which keeps
 * it out of the equality test for the same reason. The two have to agree:
 * a key the comparison counts but the panel cannot show is the unreadable
 * row `pullList` guards against.
 */
const UNCOMPARED_SETTINGS = new Set(['ogImage']);

function settingValue(settings: TLSettings | undefined, key: string): string {
  const value = (settings as Record<string, unknown> | undefined)?.[key];
  if (value === undefined || value === null || value === '') return EMPTY;
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}

/**
 * The same, for the settings row.
 *
 * Worth having for its own sake: a settings difference is otherwise the one
 * row in the panel that names no content at all, and the author has no way to
 * tell a changed theme from a share image they never touched.
 */
export function settingDiffs(
  here: TLSettings | undefined,
  theirs: TLSettings | undefined,
  base?: TLSettings,
): FieldDiff[] {
  const keys = [...new Set([...Object.keys(here ?? {}), ...Object.keys(theirs ?? {})])];
  const out: FieldDiff[] = [];
  for (const key of keys) {
    if (UNCOMPARED_SETTINGS.has(key)) continue;
    const a = settingValue(here, key);
    const b = settingValue(theirs, key);
    if (a === b) continue;
    // As for a slide: only the settings the draft itself changed.
    if (base && settingValue(base, key) === b) continue;
    out.push({ key, label: SETTING_LABELS[key] ?? key, here: a, theirs: b, long: false });
  }
  return out;
}
