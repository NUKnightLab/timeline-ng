/**
 * What a fork holds that the timeline it came from does not — [P12] in
 * `docs/phase1-sync-conflicts.md`.
 *
 * *Keep both* saves everything and resolves nothing: the working document is
 * the one with the `atUri`, and the fork is a separate document nobody can
 * publish. Reconciliation is deliberately **not** a merge screen. The fork is
 * a source to pull from, one slide at a time, in whatever order makes sense —
 * a merge screen would ask for every decision at once, and the decision that
 * matters is usually one of them.
 *
 * The comparison is the one already built. A fork carries the version it
 * diverged from (`forkedFrom.baseSnapshot`), so `threeWay(base, fork,
 * working)` attributes every change to a side exactly as it does against a
 * published record: `mine` is what the fork has, `theirs` is what the working
 * document gained meanwhile, and `collisions` is where bringing something over
 * would replace rather than fill in.
 *
 * One property worth stating, because it is what makes a fork safe to leave
 * lying around: the base is the common ancestor of *both* sides, so the
 * attribution stays correct however far the working document travels
 * afterwards. Someone can publish from three other browsers in the week before
 * anyone comes back to the fork, and the list is still honest.
 */
import type { TLEvent, TLSettings, TLTimeline } from '@knight-lab/timeline-ng-core';
import { sameValue } from './doc.ts';
import { fieldDiffs, settingDiffs, takeField } from './pullFields.ts';
import type { FieldDiff } from './pullFields.ts';
import type { TimelineDoc } from './doc.svelte.ts';
import {
  SETTINGS_ID,
  TITLE_ID,
  byId,
  comparable,
  comparableSettings,
  threeWay,
} from './threeWay.ts';

export interface PullEntry {
  /** The slide's `unique_id`, or one of the reserved ids. */
  id: string;
  /**
   * What bringing this over would do to the working document. Named for the
   * fork's change, since that is what the row offers.
   */
  kind: 'added' | 'removed' | 'edited';
  /** The row's label: the slide's headline, or what the reserved id stands for. */
  label: string;
  /** The fork's version of the slide, which is what would be written. */
  event?: TLEvent;
  /** For the settings row, the fork's settings. */
  settings?: TLSettings;
  /**
   * The working document changed this too, so bringing it over replaces
   * something rather than filling a gap. The only rows that need a warning.
   */
  contested: boolean;
  /** Which fields are contested, when the collision is field-level. */
  fields?: string[];
  /**
   * Every field the two versions disagree about, with both values ([P6]).
   *
   * Only an edited row has these: a slide that exists on one side only is a
   * whole-row decision. They are what makes a row evaluable rather than
   * merely countable — "Changed in your copy" does not tell anyone whether
   * they want the change.
   */
  diffs?: FieldDiff[];
}

export interface PullList {
  entries: PullEntry[];
  /**
   * Slides in the fork with no `unique_id`. They cannot be matched to anything
   * in the working document, so they cannot be offered as a row — and saying
   * so is better than dropping them silently. In practice this is zero: ids
   * are assigned on import and on open.
   */
  unmatchable: number;
}

/** The first line of a slide, for a row label. */
function headline(ev: TLEvent | undefined): string {
  const raw = ev?.text?.headline ?? '';
  const text = raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text || 'Untitled slide';
}

/**
 * An empty comparison is left off the entry rather than set to `[]`: an added
 * or removed slide has no field-level story, and a row carrying an empty list
 * would invite the panel to draw an empty table.
 *
 * For an *edited* row an empty comparison means something worse — the two
 * sides are not equal by the structural test but differ in no field anyone
 * can see. That row cannot be acted on: it says "Settings changed", shows
 * nothing under it, and comes back however it is answered, because answering
 * it writes a value the comparison already considers equal. So an edited row
 * is offered only when it has something showable.
 */
function withDiffs(diffs: FieldDiff[]): { diffs?: FieldDiff[] } {
  return diffs.length ? { diffs } : {};
}

export function pullList(base: TLTimeline, fork: TLTimeline, working: TLTimeline): PullList {
  const analysis = threeWay(base, fork, working);
  const inFork = byId(fork);
  const inWorking = byId(working);
  // The ancestor, so a row can offer only the fields the fork itself changed
  // — see `fieldDiffs`.
  const inBase = byId(base);
  const contested = new Map(analysis.collisions.map((c) => [c.id, c]));

  const entries: PullEntry[] = [];
  for (const change of analysis.mine) {
    const id = change.id;
    const mine = inFork.get(id);
    const theirs = inWorking.get(id);

    if (id === SETTINGS_ID) {
      // Settings are one value rather than a set of fields: an author who
      // changed any of them changed how the timeline looks as a whole.
      if (sameValue(comparableSettings(fork.settings), comparableSettings(working.settings))) continue;
      // A row nobody could read is worse than no row — see `withDiffs`.
      const diffs = settingDiffs(working.settings, fork.settings, base.settings);
      if (!diffs.length) continue;
      entries.push({
        id,
        kind: 'edited',
        label: 'Settings',
        settings: fork.settings,
        contested: contested.has(id),
        diffs,
      });
      continue;
    }

    // Already satisfied — brought over earlier, or changed identically on both
    // sides. The list is what is still outstanding, so these are simply not
    // rows. It is also what makes the list shrink as it is worked through,
    // without anything having to track which rows were clicked.
    if (mine && theirs && sameValue(comparable(mine), comparable(theirs))) continue;
    if (!mine && !theirs) continue;

    const diffs = fieldDiffs(theirs, mine, inBase.get(id));
    // An edited row with nothing showable is a row whose every line has been
    // answered — the slide still differs from the fork, because the lines
    // went different ways, but there is nothing left to decide. Offering it
    // would be the unreadable, unclearable row `withDiffs` describes.
    if (change.kind === 'edited' && !diffs.length) continue;

    const collision = contested.get(id);
    entries.push({
      id,
      kind: change.kind,
      label: id === TITLE_ID ? 'Title slide' : headline(mine ?? theirs),
      ...(mine ? { event: mine } : {}),
      contested: !!collision,
      ...(collision?.fields ? { fields: collision.fields } : {}),
      ...withDiffs(diffs),
    });
  }

  return { entries, unmatchable: (fork.events ?? []).filter((ev) => !ev.unique_id).length };
}

/**
 * Bring one entry over into the working document.
 *
 * Each of these is a single `USER_ORIGIN` transaction, so **Cmd-Z undoes it** —
 * paid for in Phase 1 and the reason the panel is safe to experiment with
 * rather than a sequence of commitments. An undone pull simply reappears as a
 * row the next time the list is computed.
 */
export function applyPull(doc: TimelineDoc, entry: PullEntry): void {
  if (entry.id === SETTINGS_ID) {
    // Every key the fork holds, and every key it has dropped: a patch that
    // only wrote what was present would leave a setting the author cleared on
    // the fork side in place here.
    const next = { ...entry.settings } as Record<string, unknown>;
    // The share image is not part of any comparison, so it is not part of any
    // answer either — carrying the draft's poster over would swap the one the
    // live share links resolve for one nobody chose, until the next publish
    // regenerated it anyway.
    delete next.ogImage;
    for (const key of Object.keys(doc.settings)) {
      if (key !== 'ogImage' && !(key in next)) next[key] = undefined;
    }
    doc.patchSettings(next as Partial<TLSettings>);
    return;
  }

  if (entry.id === TITLE_ID) {
    if (entry.kind === 'removed') doc.removeTitleSlide();
    else if (entry.event) doc.replaceEvent('title', entry.event);
    return;
  }

  const key = doc.entries.find((e) => e.event.unique_id === entry.id)?.key ?? null;
  if (entry.kind === 'removed') {
    if (key) doc.removeEvent(key);
    return;
  }
  if (!entry.event) return;
  // `replaceEvent`, not `updateEvent`: the prose is part of what is being
  // brought over, and ordinary slide writes deliberately leave it alone.
  if (key) doc.replaceEvent(key, entry.event);
  else doc.addEvent(entry.event);
}

/**
 * Bring **one field** of an entry over, leaving the rest of the slide alone.
 *
 * The whole-row pull stays: often the fork's version of a slide is simply the
 * one you want. This is for the other case, where two versions differ in one
 * word of a headline and a whole-slide decision would quietly carry a date or
 * a caption the author never looked at.
 *
 * Mechanically the same single transaction as a whole-row pull — it writes a
 * whole slide either way, just one assembled from both sides — so undo
 * behaves identically and the row recomputes on its own.
 */
export function applyPullField(doc: TimelineDoc, entry: PullEntry, key: string): void {
  if (entry.id === SETTINGS_ID) {
    const value = (entry.settings as Record<string, unknown> | undefined)?.[key];
    doc.patchSettings({ [key]: value } as Partial<TLSettings>);
    return;
  }

  if (!entry.event) return;

  if (entry.id === TITLE_ID) {
    const current = doc.titleEvent;
    if (current) doc.replaceEvent('title', takeField(current, entry.event, key));
    return;
  }

  const found = doc.entries.find((e) => e.event.unique_id === entry.id);
  if (!found) return;
  doc.replaceEvent(found.key, takeField(found.event, entry.event, key));
}

/**
 * Settle a row the other way: keep what this timeline has.
 *
 * A row used to have one action, which made a row you did not want a dead
 * end — the panel would offer it again every time, the fork would never
 * empty, and the editor would go on saying there were edits to deal with.
 * Declining has to be recorded somewhere, because the list is deliberately
 * stateless: it is recomputed from the documents every time, and nothing
 * tracks what was clicked.
 *
 * It is recorded in the fork's **ancestor**, by moving that slide's recorded
 * base up to the fork's own version of it. The fork then has no change to
 * report for that slide, so the row stops being offered — permanently, and
 * however far the working document travels afterwards. This is the ordinary
 * way a merge records a resolution, and it keeps the comparison honest for
 * every other slide.
 *
 * Two consequences, both deliberate. The fork's content is untouched, so
 * opening it still shows what it held. And this is not a document edit, so
 * Cmd-Z does not bring the row back — the panel says so.
 */
export function declinePull(base: TLTimeline, fork: TLTimeline, entry: PullEntry): TLTimeline {
  if (entry.id === SETTINGS_ID) {
    return { ...base, settings: fork.settings };
  }

  if (entry.id === TITLE_ID) {
    if (!fork.title) {
      const { title: _gone, ...rest } = base;
      return rest as TLTimeline;
    }
    return { ...base, title: fork.title };
  }

  const inFork = byId(fork).get(entry.id);
  const events = (base.events ?? []).filter((ev) => ev.unique_id !== entry.id);
  // Absent from the fork is itself the fork's version: a slide it deleted
  // must leave the ancestor too, or the deletion stays on offer.
  return { ...base, events: inFork ? [...events, inFork] : events };
}

/**
 * Settle **one line** the published way, leaving the rest of the row alone.
 *
 * The row-level decline's counterpart, and the reason the two buttons on a
 * line are now a pair. With only *Keep mine* per line, the published half of
 * the choice existed solely as a whole-row button, which raised a fair
 * question nobody should have to ask: does it undo the lines I already kept?
 * (It did not — a line drops off as soon as the document holds its value —
 * but nothing on screen said so.)
 *
 * Recorded exactly as `declinePull` records a row: the ancestor's value for
 * that one field moves up to the draft's, so the draft has no change left to
 * report for it. Which is also why a line has to be *derived* from the
 * ancestor for this to work at all — see `fieldDiffs`.
 */
export function declinePullField(
  base: TLTimeline,
  fork: TLTimeline,
  entry: PullEntry,
  key: string,
): TLTimeline {
  if (entry.id === SETTINGS_ID) {
    const next = { ...base.settings } as Record<string, unknown>;
    const value = (fork.settings as Record<string, unknown> | undefined)?.[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
    return { ...base, settings: next as TLSettings };
  }

  const inFork = byId(fork).get(entry.id);
  if (!inFork) return base;

  if (entry.id === TITLE_ID) {
    return base.title ? { ...base, title: takeField(base.title, inFork, key) } : base;
  }

  return {
    ...base,
    events: (base.events ?? []).map((ev) =>
      ev.unique_id === entry.id ? takeField(ev, inFork, key) : ev),
  };
}

/**
 * What a merge or a fast-forward brought in — the review side of [P9].
 *
 * A merge used to be invisible and irreversible: `adopt` applies it under
 * `LOAD_ORIGIN` and clears the undo stack, so slides could arrive from
 * another browser with no way to see what they were or take them back. The
 * merge still happens without asking — most of them are trivial, and a dialog
 * for every one of those is how people learn to dismiss the dialog that
 * matters — but it is now inspectable, a row at a time.
 *
 * This is an ordinary two-way comparison, not a three-way one: `before` and
 * `after` are two states of the *same* document, so there is no third version
 * to attribute anything to.
 *
 * The rows are `PullEntry` and nothing else, so `applyPull`, `applyPullField`
 * and the panel work unchanged. `kind` keeps its meaning throughout — what
 * applying this row's version would do to the document — which inverts
 * against the arrival: a slide the merge *added* is a row that would *remove*
 * it, because the version on offer is the one from before.
 */
export function incomingList(before: TLTimeline, after: TLTimeline): PullList {
  const was = byId(before);
  const now = byId(after);
  const entries: PullEntry[] = [];

  for (const id of new Set([...was.keys(), ...now.keys()])) {
    if (id === SETTINGS_ID) continue;
    const b = was.get(id);
    const a = now.get(id);
    if (b && a && sameValue(comparable(b), comparable(a))) continue;
    if (!b && !a) continue;
    entries.push({
      id,
      kind: !b ? 'removed' : !a ? 'added' : 'edited',
      label: id === TITLE_ID ? 'Title slide' : headline(a ?? b),
      ...(b ? { event: b } : {}),
      contested: false,
      ...withDiffs(fieldDiffs(a, b)),
    });
  }

  // Both tests, for the reason given at `withDiffs`: structurally different,
  // and different in a way the panel can put in front of someone.
  const settings = settingDiffs(after.settings, before.settings);
  if (settings.length && !sameValue(comparableSettings(before.settings), comparableSettings(after.settings))) {
    entries.push({
      id: SETTINGS_ID,
      kind: 'edited',
      label: 'Settings',
      settings: before.settings,
      contested: false,
      diffs: settings,
    });
  }

  // Nothing here can be unmatchable: both sides are the same document, and
  // ids were assigned before the comparison ran.
  return { entries, unmatchable: 0 };
}

/**
 * Whether a row still has something to offer: the document does not yet hold
 * the version the row carries.
 *
 * The same rule the pull-list applies when it decides a row has been dealt
 * with, exported so a list that was computed once — what a merge brought in —
 * can be narrowed the same way as it is worked through.
 */
export function outstanding(entry: PullEntry, working: TLTimeline): boolean {
  if (entry.id === SETTINGS_ID) {
    return !sameValue(comparableSettings(entry.settings), comparableSettings(working.settings));
  }
  const here = byId(working).get(entry.id);
  if (!entry.event) return !!here;
  if (!here) return true;
  return !sameValue(comparable(here), comparable(entry.event));
}
