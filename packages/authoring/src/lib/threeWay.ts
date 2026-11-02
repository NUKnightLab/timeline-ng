/**
 * Comparing a local draft and a published record against the version they
 * both came from.
 *
 * Deliberately three-way, never two-way ([P6] in
 * `docs/phase1-sync-conflicts.md`). A two-way diff makes every difference look
 * like a disagreement, including the person's own unpublished work, which is
 * not in dispute with anything. With the base in hand each change belongs to a
 * side: *you changed this; the published version changed that.*
 *
 * The derived fact that matters most is the overlap — what both sides changed,
 * and differently. Everything else follows from it, including whether there is
 * a decision to make at all: when nothing collides, the two sides merge with no
 * judgement call anywhere in the merge ([P9]), and nobody is asked anything.
 *
 * Two honest limits, both from the published side being flat JSON. This reports
 * *net* change, never an activity log — "changed the title" may have been six
 * edits by two people. And rich text that both sides edited cannot merge
 * character by character, because the published side has no history; that is
 * what makes such a field a collision rather than a merge.
 */
import type { TLEvent, TLSettings, TLTimeline } from '@knight-lab/timeline-ng-core';
import { sameValue } from './doc.ts';

/** The title slide and the settings are compared alongside the events, under reserved ids. */
export const TITLE_ID = '(title slide)';
export const SETTINGS_ID = '(settings)';

export type ChangeKind = 'added' | 'removed' | 'edited';

export interface SlideChange {
  /** The slide's `unique_id`, or one of the reserved ids above. */
  id: string;
  kind: ChangeKind;
  /** Which fields changed, for an edit. Absent for an add or a remove. */
  fields?: string[];
}

export interface Collision {
  id: string;
  /**
   * What cannot be decided here. `fields` for two different values in the same
   * field; `kind` when one side removed what the other edited, which no
   * field-level account can describe.
   */
  fields?: string[];
  reason: 'fields' | 'removed-vs-edited';
}

export interface ThreeWay {
  /** Changes this browser made since the shared version. */
  mine: SlideChange[];
  /** Changes the published record gained since the shared version. */
  theirs: SlideChange[];
  /**
   * Where the two genuinely disagree. Empty means there is nothing to ask
   * about, however much each side changed on its own.
   */
  collisions: Collision[];
  /**
   * The two sides merged, or null when they collide. Non-null exactly when
   * `collisions` is empty, so this is the test for "can this be done without
   * asking".
   */
  merged: TLTimeline | null;
}

/**
 * A slide as it is for comparison purposes: without the URLs derived from
 * blob references.
 *
 * `getTimeline` builds a `url` for every blob-backed image from the CID and
 * the PDS origin, because the editor needs something to render. It is not
 * content — it is recomputed on every read, and it changes if the account
 * moves to another host — so a side that happens to carry it must not read as
 * having changed anything. The merge still copies whole fields from the real
 * objects, so nothing is stripped from what the author ends up with.
 */
function comparable(ev: TLEvent): TLEvent {
  const strip = (m: Record<string, unknown> | undefined) =>
    m && m.blobRef ? (({ url: _url, ...rest }) => rest)(m) : m;
  return {
    ...ev,
    ...(ev.media ? { media: strip(ev.media as Record<string, unknown>) as TLEvent['media'] } : {}),
    ...(ev.background ? { background: strip(ev.background as Record<string, unknown>) as TLEvent['background'] } : {}),
  };
}

/** The same, for the one derived URL in settings. */
function comparableSettings(s: TLSettings | undefined): TLSettings | undefined {
  if (!s?.ogImage?.blobRef) return s;
  const { url: _url, ...ogImage } = s.ogImage;
  return { ...s, ogImage };
}

/** Index a timeline's slides by `unique_id`, which a published record guarantees is unique. */
function byId(tl: TLTimeline): Map<string, TLEvent> {
  const out = new Map<string, TLEvent>();
  for (const ev of tl.events ?? []) {
    const id = ev.unique_id;
    // A slide with no id cannot be matched across versions at all. Skipping it
    // would quietly drop it from a merge, so the caller is told instead.
    if (typeof id === 'string' && id !== '') out.set(id, ev);
  }
  if (tl.title) out.set(TITLE_ID, tl.title);
  return out;
}

/** Whether any slide on either side is unmatchable, which makes a merge unsafe. */
export function hasUnkeyedSlides(tl: TLTimeline): boolean {
  return (tl.events ?? []).some((ev) => typeof ev.unique_id !== 'string' || ev.unique_id === '');
}

const EVENT_FIELDS = (a: TLEvent, b: TLEvent): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])];

/** Which fields differ between two versions of one slide. */
function changedFields(from: TLEvent, to: TLEvent): string[] {
  const a = comparable(from);
  const b = comparable(to);
  return EVENT_FIELDS(a, b).filter((k) => !sameValue(a[k as keyof TLEvent], b[k as keyof TLEvent]));
}

/** One side's changes to one slide, against the base. */
function changeFor(id: string, base: TLEvent | undefined, side: TLEvent | undefined): SlideChange | null {
  if (!base && !side) return null;
  if (!base) return { id, kind: 'added' };
  if (!side) return { id, kind: 'removed' };
  const fields = changedFields(base, side);
  return fields.length ? { id, kind: 'edited', fields } : null;
}

export function threeWay(base: TLTimeline, mine: TLTimeline, theirs: TLTimeline): ThreeWay {
  const b = byId(base);
  const m = byId(mine);
  const t = byId(theirs);
  const ids = [...new Set([...b.keys(), ...m.keys(), ...t.keys()])];

  const mineChanges: SlideChange[] = [];
  const theirsChanges: SlideChange[] = [];
  const collisions: Collision[] = [];
  /** The merged slides, by id, built as we go. */
  const merged = new Map<string, TLEvent>();

  for (const id of ids) {
    const base0 = b.get(id);
    const mine0 = m.get(id);
    const theirs0 = t.get(id);

    const mineChange = changeFor(id, base0, mine0);
    const theirsChange = changeFor(id, base0, theirs0);
    if (mineChange) mineChanges.push(mineChange);
    if (theirsChange) theirsChanges.push(theirsChange);

    // Untouched, or touched on one side only: take whichever side moved. A
    // removal on one side and silence on the other is still a removal.
    if (!mineChange) {
      if (theirs0) merged.set(id, theirs0);
      continue;
    }
    if (!theirsChange) {
      if (mine0) merged.set(id, mine0);
      continue;
    }

    // Both sides moved. Identical moves are not disagreements — two people
    // fixing the same typo agree.
    if (mine0 && theirs0 && sameValue(comparable(mine0), comparable(theirs0))) {
      merged.set(id, mine0);
      continue;
    }

    // One side removed what the other edited. There is no field-level account
    // of this: the question is whether the slide should exist, and only a
    // person can answer it.
    if (!mine0 || !theirs0) {
      collisions.push({ id, reason: 'removed-vs-edited' });
      continue;
    }

    // Added on both sides under the same id, with different content. There is
    // no base to attribute anything to, so every difference is a disagreement
    // and there is nothing to merge through.
    if (!base0) {
      collisions.push({ id, reason: 'fields', fields: changedFields(mine0, theirs0) });
      continue;
    }

    // Both edited. Field by field: a field only one side touched merges, and
    // only a field with two different values is a real collision. Slide-level
    // overlap is frequently non-empty while field-level overlap is empty —
    // which is the difference between asking and not asking.
    const mineFields = new Set(mineChange.fields ?? []);
    const theirsFields = new Set(theirsChange.fields ?? []);
    const mineCmp = comparable(mine0);
    const theirsCmp = comparable(theirs0);
    const contested = [...mineFields].filter(
      (f) => theirsFields.has(f) && !sameValue(mineCmp[f as keyof TLEvent], theirsCmp[f as keyof TLEvent]),
    );
    if (contested.length) {
      collisions.push({ id, reason: 'fields', fields: contested });
      continue;
    }
    // Replay each side's changed fields onto the base, theirs first so that a
    // field only one side touched lands whoever touched it. A field a side
    // *cleared* has to clear here too — copying only defined values would
    // quietly restore it from the base and lose the deletion.
    const slide: Record<string, unknown> = { ...base0 };
    for (const f of theirsFields) applyField(slide, f, theirs0);
    for (const f of mineFields) applyField(slide, f, mine0);
    merged.set(id, slide as TLEvent);
  }

  // Settings merge as one value rather than field by field: they are a small
  // record of presentation choices, and an author who changed any of them
  // changed how the timeline looks as a whole.
  const settings = mergeSettings(base.settings, mine.settings, theirs.settings);
  if (settings.mineChanged) mineChanges.push({ id: SETTINGS_ID, kind: 'edited' });
  if (settings.theirsChanged) theirsChanges.push({ id: SETTINGS_ID, kind: 'edited' });
  if (settings.collides) collisions.push({ id: SETTINGS_ID, reason: 'fields' });

  // A slide with no `unique_id` cannot be matched to its counterpart, so a
  // merge would either duplicate or drop it. Report that as something to
  // decide rather than guessing.
  const unkeyed = hasUnkeyedSlides(mine) || hasUnkeyedSlides(theirs);

  return {
    mine: mineChanges,
    theirs: theirsChanges,
    collisions,
    merged: collisions.length || unkeyed ? null : assemble(mine, merged, settings.value),
  };
}

function applyField(target: Record<string, unknown>, field: string, from: TLEvent): void {
  const v = from[field as keyof TLEvent];
  if (v === undefined) delete target[field];
  else target[field] = v;
}

function mergeSettings(base: TLSettings | undefined, mine: TLSettings | undefined, theirs: TLSettings | undefined) {
  const b = comparableSettings(base);
  const m = comparableSettings(mine);
  const t = comparableSettings(theirs);
  const mineChanged = !sameValue(b, m);
  const theirsChanged = !sameValue(b, t);
  if (mineChanged && theirsChanged && !sameValue(m, t)) {
    return { mineChanged, theirsChanged, collides: true, value: mine };
  }
  return { mineChanged, theirsChanged, collides: false, value: mineChanged ? mine : theirs };
}

/**
 * Put the merged slides back into a timeline.
 *
 * Order is taken from `mine` and then whatever is new, but only for
 * determinism: the player sorts slides by date, so the array's order is not
 * something a reader ever sees (coauthoring.md §3.2).
 */
function assemble(mine: TLTimeline, merged: Map<string, TLEvent>, settings: TLSettings | undefined): TLTimeline {
  const order = [...(mine.events ?? []).map((e) => e.unique_id), ...merged.keys()];
  const events: TLEvent[] = [];
  const seen = new Set<string>([TITLE_ID]);
  for (const id of order) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const ev = merged.get(id);
    if (ev) events.push(ev);
  }
  const title = merged.get(TITLE_ID);
  return {
    events,
    ...(title ? { title } : {}),
    ...(settings ? { settings } : {}),
  };
}
