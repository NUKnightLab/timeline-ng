/**
 * One row per timeline — [P5] in `docs/phase1-sync-conflicts.md`.
 *
 * The home screen used to draw two lists: drafts held in this browser, and
 * records in the account. A published timeline that had been opened here
 * appeared in both, as two rows for one thing, each with its own ✕ meaning
 * something different. [P4] fixed the duplicate *drafts*; this is the
 * presentation half it left behind.
 *
 * A row is a **timeline**, and where it lives is something the row says
 * rather than something its position implies. That is what lets one ✕ have
 * one meaning — delete this timeline — with the consequence following from
 * whether it is public, rather than from which list it was in.
 *
 * Kept out of the component because this is the part worth testing: the
 * matching, the ordering, and the six states a row can be in. A component
 * test would exercise markup to check arithmetic.
 */
import type { DraftSummary } from './localStore.ts';

/**
 * The account a record belongs to, read off its AT-URI: `at://<did>/…`.
 *
 * Ownership lives in the record, not in the draft. A draft that has never
 * been published has no owner — it is not owned by anyone until it is — and
 * keying local storage by account would have meant needing to be signed in
 * to start a timeline at all, which is the opposite of what offline editing
 * is for.
 */
export function ownerOf(atUri: string | undefined): string | null {
  if (!atUri?.startsWith('at://')) return null;
  return atUri.split('/')[2] || null;
}

/** A record in the account, as `listTimelines` returns it. */
export interface TimelineRecord {
  uri: string;
  cid: string;
  title: string;
  createdAt: string;
}

/**
 * What the row says about where this timeline stands.
 *
 * `behind` is the one the merged list buys: the record's CID differs from
 * the one this draft was last in step with, so another browser has published
 * since. Opening it is what resolves that, and until this the only way to
 * find out was to open it.
 */
export type RowState =
  | 'unpublished'   // never published; exists only in this browser
  | 'published'     // local copy matches the record, or there is no local copy
  | 'changed'       // local edits not yet published
  | 'behind'        // the record moved on in another browser
  | 'gone';         // a local copy whose record is no longer in the account

export interface TimelineRow {
  /** Stable across a reload: the record's URI where there is one, else the draft's id. */
  key: string;
  title: string;
  state: RowState;
  /** Whether this timeline exists anywhere but this browser. */
  published: boolean;
  /** The draft to open, when this browser has one. */
  draft: DraftSummary | null;
  record: TimelineRecord | null;
  /** Unmerged drafts belonging to this timeline, nested under it ([A4]). */
  forks: DraftSummary[];
  /**
   * Set when this timeline belongs to an account other than the one signed
   * in — a browser used for more than one identity, which is ordinary for
   * anyone who publishes both personally and for an organisation.
   *
   * The row is still listed. Hiding it would read as the app having lost a
   * timeline, and whoever has the browser has the drafts in any case. What
   * changes is that nothing in this account's record list is evidence about
   * it: see `stateFor`.
   */
  otherAccount?: { did: string; handle?: string };
  /** When this was last touched, for the order and for the row's own line. */
  editedAt: string;
}

const UNTITLED = 'Untitled draft';

function titleFor(draft: DraftSummary | null, record: TimelineRecord | null): string {
  return draft?.title?.trim() || record?.title?.trim() || UNTITLED;
}

/**
 * Which of the six, in the order that matters.
 *
 * `gone` first because every other state would be a claim about a record
 * that is not there. `behind` before `changed` because a local edit is
 * something the author can act on whenever they like, while another
 * browser having published is news.
 */
function stateFor(
  draft: DraftSummary | null,
  record: TimelineRecord | null,
  recordsKnown: boolean,
): RowState {
  if (!draft) return 'published';
  if (!draft.atUri) return 'unpublished';
  // An empty record list is not evidence of anything on its own: signed out,
  // or still fetching, it means we have not looked. Saying a timeline left
  // the account on that basis would tell someone their published work had
  // vanished every time they opened the page signed out.
  if (!record) return recordsKnown ? 'gone' : (draft.clean === true ? 'published' : 'changed');
  // Absent on entries written before the base CID was recorded. Saying
  // nothing is better than saying "behind" about every one of them.
  if (draft.baseCid && draft.baseCid !== record.cid) return 'behind';
  return draft.clean === true ? 'published' : 'changed';
}

/**
 * Merge what this browser holds with what the account holds.
 *
 * `records` is empty while the fetch is in flight and when signed out, which
 * is deliberately not a special case: the list draws immediately from local
 * drafts, and records fold in by `atUri` when they arrive. Rows keyed by the
 * record's URI where there is one, so a row does not change identity as it
 * gains its record.
 */
export function timelineRows(
  drafts: DraftSummary[],
  records: TimelineRecord[],
  /**
   * Whether `records` is the account's actual contents. False while signed
   * out or mid-fetch, when an absent record means "not looked", not "not
   * there" — see `stateFor`.
   */
  recordsKnown = true,
  /** The DID signed in, when one is. Rows belonging to anyone else are marked. */
  viewerDid: string | null = null,
): TimelineRow[] {
  const byUri = new Map(records.map((r) => [r.uri, r]));
  // An unmerged draft is never a row of its own: it belongs under the
  // timeline it came from ([A4]), and is listed there.
  const owners = drafts.filter((d) => !d.forkedFrom);
  const claimed = new Set<string>();

  const rows: TimelineRow[] = owners.map((draft) => {
    const record = (draft.atUri && byUri.get(draft.atUri)) || null;
    if (record) claimed.add(record.uri);
    const owner = ownerOf(draft.atUri);
    // Another account's timeline: this account's record list says nothing
    // about whether it still exists, so the comparison is not run at all.
    // Without this it read as "no longer in your account", which is a
    // confident and wrong statement about somebody else's record.
    const elsewhere = !!owner && !!viewerDid && owner !== viewerDid;
    return {
      key: record?.uri ?? draft.atUri ?? draft.id,
      title: titleFor(draft, record),
      state: stateFor(draft, record, recordsKnown && !elsewhere),
      published: !!record,
      draft,
      record,
      forks: draft.atUri ? drafts.filter((d) => d.forkedFrom?.atUri === draft.atUri) : [],
      editedAt: draft.editedAt,
      ...(elsewhere ? { otherAccount: { did: owner, ...(draft.ownerHandle ? { handle: draft.ownerHandle } : {}) } } : {}),
    };
  });

  for (const record of records) {
    if (claimed.has(record.uri)) continue;
    rows.push({
      key: record.uri,
      title: titleFor(null, record),
      state: 'published',
      published: true,
      draft: null,
      record,
      // A fork whose own timeline is not in this browser is listed at the top
      // level instead; `orphanForks` finds those.
      forks: [],
      editedAt: record.createdAt,
    });
  }

  // One order for two sources: most recently touched first, where a local
  // copy's own `editedAt` beats the record's creation date, since that is
  // the date the author would recognise.
  return rows.sort((a, b) => (a.editedAt < b.editedAt ? 1 : a.editedAt > b.editedAt ? -1 : 0));
}

/**
 * Unmerged drafts with nothing to nest under — the timeline they came from
 * is no longer in this browser. They have to appear somewhere, or they are
 * work that cannot be reached.
 */
export function orphanForks(drafts: DraftSummary[]): DraftSummary[] {
  return drafts.filter((d) =>
    d.forkedFrom && !drafts.some((o) => !o.forkedFrom && o.atUri === d.forkedFrom?.atUri));
}
