<script lang="ts">
  import { onMount } from 'svelte';
  import type { TLEvent, TLTimeline, TLSettings } from '@knight-lab/timeline-ng-core';
  import { toTL3CSV, assignSlideIds } from '@knight-lab/timeline-ng-core';
  import { getAuthState, publishTimeline, signOut, uploadBlob, blobUrl, extractCid, listTimelines, getTimeline } from './lib/atproto.svelte.ts';
  import { initAuth } from './lib/atproto.svelte.ts';
  import { generatePoster } from './lib/poster.ts';
  import { listDrafts, newDocId, noteDraft, forgetDraft, forgetDraftWithForks, persistDoc, readDraftTimeline,
    removeDraftEntries, restoreDraftEntries, commitDraftDeletions, sweepPendingDeletions } from './lib/localStore.ts';
  import type { DraftSummary } from './lib/localStore.ts';
  import { applyPull, applyPullField, declinePull, declinePullField, incomingList, outstanding, pullList } from './lib/pullList.ts';
  import { ownerOf } from './lib/timelineRows.ts';
  import type { PullEntry } from './lib/pullList.ts';
  import { migrateLegacyDraft } from './lib/draftMigration.ts';
  import type { IndexeddbPersistence } from 'y-indexeddb';
  import { TimelineDoc, HEADLINE_FIELD, BODY_FIELD } from './lib/doc.svelte.ts';
  import { requestHistory } from './lib/historyBus.ts';
  import { stripHtml } from './lib/text.ts';
  import { reconcile } from './lib/reconcile.ts';
  import type { ThreeWay } from './lib/threeWay.ts';
  import HomeView from './components/HomeView.svelte';
  import EditorView from './components/EditorView.svelte';
  import ConflictChoice from './components/ConflictChoice.svelte';
  import ForkPullList from './components/ForkPullList.svelte';

  // ── Synchronous OAuth restore check (must run before first render) ───────────

  /** Which draft the editor has open, so a redirect or reload can return to it. */
  const CURRENT_DOC_KEY = 'tl-current-doc';

  const _restoreFlag = sessionStorage.getItem('tl-post-auth-restore');
  const _restoreView = sessionStorage.getItem('tl-post-auth-view');
  const _restoreDocId = sessionStorage.getItem(CURRENT_DOC_KEY);
  const _startInEditor = _restoreFlag === '1' && _restoreView === 'editor' && !!_restoreDocId;
  if (_restoreFlag) {
    sessionStorage.removeItem('tl-post-auth-restore');
    sessionStorage.removeItem('tl-post-auth-view');
  }

  // ── View ─────────────────────────────────────────────────────────────────────

  let view = $state<'home' | 'editor'>(_startInEditor ? 'editor' : 'home');

  // ── Editor state ─────────────────────────────────────────────────────────────

  const DEFAULT_SETTINGS: TLSettings = { language: 'en', theme: 'auto', initialIndex: 0, reverseOrder: false };

  // The Yjs document is the source of truth; everything below reads a plain
  // snapshot of it. See lib/doc.svelte.ts and docs/coauthoring.md §3.2.
  //
  // Reassigned when a different draft is opened, rather than reloaded in place:
  // a Yjs document carries its whole history, so pouring a second timeline into
  // the same one would persist both into that draft's store.
  let tldoc = $state(new TimelineDoc());
  let docId = $state<string | null>(null);
  let provider: IndexeddbPersistence | null = null;

  /** Set when the browser will not store drafts locally — see persistDoc. */
  let persistWarning = $state<string | null>(null);

  let drafts = $state<DraftSummary[]>([]);

  /**
   * Which slide the editor is on: an internal slide key, or `'title'`.
   *
   * Not a `unique_id`. That is an author-facing, editable field with no
   * uniqueness guarantee once two people can edit at once, so it cannot serve
   * as identity — see TimelineDoc.eventForKey.
   */
  let selectedId = $state<string | null>(null);
  let publishStatus = $state<string | null>(null);
  let publishTone = $state<'ok' | 'warn'>('ok');

  /**
   * The collision from Scripts 5 and 6, held until the author settles it.
   *
   * The editor stays behind the dialog rather than being replaced by it: what
   * is behind it is their own draft, which is useful context for the choice and
   * is not at risk from looking at it.
   */
  let conflict = $state<{
    analysis: ThreeWay;
    published: TLTimeline;
    publishedCid: string;
    publishedAt?: string;
    occasion: 'open' | 'publish';
  } | null>(null);

  /**
   * The quiet line from Scripts 3, 7 and 8, and from an automatic merge.
   *
   * Dismissible and not a prompt: each of these is something that happened, not
   * something to decide. But they are said rather than hidden — Script 8's rule
   * that the editor must never claim to be in sync when it has not checked cuts
   * both ways, so a change it made on the author's behalf is announced too.
   */
  let syncNote = $state<string | null>(null);

  /** Set while the open draft is a fork: it holds no claim on a record ([P10]). */
  let forkOf = $state<DraftSummary['forkedFrom'] | null>(null);

  /**
   * The open pull-list, while a fork of the working document is being
   * reconciled ([P12]). `fork` is that document's content, read once and kept
   * so each pull can recompute the list without touching IndexedDB again —
   * the fork does not change while this is open; the working document does.
   */
  let pull = $state<{
    /** Which question the panel is asking — see ForkPullList's `mode`. */
    mode: 'fork' | 'incoming' | 'arrived';
    /** Set for a fork; null while reviewing what arrived, which has no second document. */
    forkId: string | null;
    base: TLTimeline | null;
    fork: TLTimeline | null;
    entries: PullEntry[];
    unmatchable: number;
  } | null>(null);

  /**
   * What a merge or fast-forward brought in, kept so it can be reviewed.
   *
   * Held from the moment it lands until the draft is closed or another check
   * replaces it: the note offers a review, and the review has to still have
   * the before-state when it is taken up a minute later. `reading` is a
   * fast-forward, where nothing local was at risk and the list is only worth
   * looking at.
   */
  let incoming = $state<{ entries: PullEntry[]; reading: boolean } | null>(null);

  /**
   * What each fork of the open timeline still has to offer.
   *
   * The draft index cannot answer this. It records that a fork exists, not
   * whether anything in it is still outstanding — and a fork that has been
   * worked through survives until someone deletes it. Counting drafts made
   * the editor insist there were edits to bring across when the pull-list,
   * once opened, had nothing in it. So each fork is read and compared, and
   * `outstanding` is what the banner speaks from.
   */
  let forkOffers = $state<{
    id: string;
    base: TLTimeline | null;
    fork: TLTimeline | null;
    outstanding: number;
  }[]>([]);
  /** Bumped after each undo or redo; the slide editor re-reads its fields when it moves. */
  let historyVersion = $state(0);

  const timelineTitle = $derived(tldoc.title);
  const titleEvent = $derived(tldoc.titleEvent);
  const events = $derived(tldoc.events);
  const settings = $derived(tldoc.settings);
  const atUri = $derived(tldoc.atUri);
  const pdsClean = $derived(tldoc.clean);

  // ── Draft ────────────────────────────────────────────────────────────────────


  /**
   * The slide the restore row can bring back. `stackItem` is the deletion's
   * entry in undo history, so the row can restore through undo when nothing has
   * happened since — see undoDelete.
   */
  let deletedItem = $state<{ event: TLEvent; isTitle: boolean; sortedIndex: number; stackItem: object | null } | null>(null);

  /**
   * A deleted draft, and where its row was, while undo is still on offer.
   * `entries` is the draft plus any unmerged drafts that went with it; the
   * first is the one the card names.
   */
  let deletedDrafts = $state<{ entries: DraftSummary[]; index: number } | null>(null);
  let deletedDraftsLeaving = $state(false);
  let _draftUndoTimer: ReturnType<typeof setTimeout> | null = null;
  /** Long enough to notice the row went and reach for the card. */
  const UNDO_WINDOW = 8000;
  let deletedItemLeaving = $state(false);
  let _undoTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ──────────────────────────────────────────────────────────────────

  const auth = $derived(getAuthState());

  /**
   * The handle to record alongside a draft's `atUri`, for the row that has
   * to say whose timeline it is.
   *
   * Only the signed-in account's own handle is known here without a lookup,
   * which is also the only case that needs recording: a draft only ever
   * gains an `atUri` from publishing or from opening a record in the account
   * signed in at the time.
   */
  function handleFor(uri: string | null | undefined): string | undefined {
    if (!uri || auth.status !== 'signed-in') return undefined;
    return uri.split('/')[2] === auth.session.sub ? auth.handle : undefined;
  }

  // The document already orders slides by date, so there is nothing left to sort.
  const sortedEvents = $derived(events);
  const timeline = $derived<TLTimeline>(tldoc.timeline);

  // Null when this field has no fragment — a slide whose prose could not be
  // represented without loss keeps plain HTML, and the editor edits that
  // instead. See ensureFragments.
  const headlineFragment = $derived(tldoc.fragmentFor(selectedId, HEADLINE_FIELD));
  const bodyFragment = $derived(tldoc.fragmentFor(selectedId, BODY_FIELD));

  const selectedEvent = $derived(tldoc.eventForKey(selectedId));

  const isEditingTitle = $derived(selectedId === 'title');

  const canPublish = $derived(auth.status === 'signed-in' && (events.length > 0 || !!titleEvent));

  // ── Keeping the drafts list current ───────────────────────────────────────────
  //
  // The document persists itself — that is what y-indexeddb is for, and there is
  // no longer any "save the draft" step. What still needs writing is the *index*
  // the home screen lists from, which holds a title and a timestamp so drafts
  // can be shown without opening every one of them.

  let _indexTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (view !== 'editor' || docId === null) return;
    const id = docId;
    const title = timelineTitle;
    const uri = atUri;
    const hasContent = !!titleEvent || events.length > 0;
    // Tracked, so marking clean on publish rewrites the index entry too.
    const clean = pdsClean;
    void settings;

    if (_indexTimer !== null) clearTimeout(_indexTimer);
    if (!hasContent) return;

    _indexTimer = setTimeout(() => {
      _indexTimer = null;
      noteDraft({ id, title, atUri: uri ?? undefined, clean, baseCid: tldoc.baseCid ?? undefined, ownerHandle: handleFor(uri) });
      drafts = listDrafts();
    }, 600);

    return () => {
      if (_indexTimer !== null) { clearTimeout(_indexTimer); _indexTimer = null; }
    };
  });


  // Auto-sync title from title slide headline when user hasn't set one explicitly.
  // The equality check matters: this effect both reads the document and writes
  // back into it, and Y.Map.set emits an update even for an unchanged value.
  $effect(() => {
    if (tldoc.titleSetByUser) return;
    const fromHeadline = stripHtml(tldoc.titleEvent?.text?.headline);
    // Derived, so untracked: undoing the headline recomputes this, and a
    // tracked recomputation would clear the redo stack after every such undo.
    if (fromHeadline !== tldoc.title) tldoc.setTitle(fromHeadline, false, { derived: true });
  });

  // A selection can outlive its slide: undo removing a slide that was added, and
  // in Phase 2 a collaborator deleting one. Fall back to a slide that exists
  // rather than leaving the editor pointed at nothing.
  $effect(() => {
    if (view !== 'editor' || selectedId === null) return;
    if (tldoc.eventForKey(selectedId)) return;
    const remaining = tldoc.entries;
    selectedId = remaining[remaining.length - 1]?.key ?? (tldoc.titleEvent ? 'title' : null);
  });

  // ── Opening, closing and swapping drafts ──────────────────────────────────────

  /** Detach persistence and let the current document go. */
  async function closeDraft() {
    if (_indexTimer !== null) { clearTimeout(_indexTimer); _indexTimer = null; }
    // Whatever the last reconciliation said was about the draft being closed.
    syncNote = null;
    conflict = null;
    pull = null;
    incoming = null;
    forkOffers = [];
    if (provider) {
      await provider.destroy();
      provider = null;
    }
    tldoc.destroy();
    docId = null;
    sessionStorage.removeItem(CURRENT_DOC_KEY);
  }

  /** Attach local persistence, tolerating a browser that will not store anything. */
  async function attach(id: string) {
    const result = await persistDoc(id, tldoc.doc);
    provider = result.provider;
    persistWarning = result.error;
  }

  /** Start a new draft holding `timeline`. */
  async function createDraft(
    timeline: TLTimeline,
    meta: { title?: string; titleSetByUser?: boolean; atUri?: string; baseCid?: string },
    opts: { clean?: boolean } = {},
  ) {
    await closeDraft();
    tldoc = new TimelineDoc();
    tldoc.load(timeline, meta, opts);

    const id = newDocId();
    docId = id;
    sessionStorage.setItem(CURRENT_DOC_KEY, id);
    await attach(id);
    noteDraft({ id, title: tldoc.title, atUri: meta.atUri, clean: tldoc.clean, baseCid: tldoc.baseCid ?? undefined, ownerHandle: handleFor(meta.atUri) });
    drafts = listDrafts();

    selectedId = tldoc.titleEvent ? 'title' : (tldoc.entries[0]?.key ?? null);
    forkOf = null;
    view = 'editor';
  }

  /**
   * Reopen a stored draft.
   *
   * The document is left empty and filled by the persistence provider, rather
   * than loaded and then attached: attaching merges, so seeding it first would
   * duplicate everything the store already holds.
   */
  async function openDraft(id: string) {
    await closeDraft();
    tldoc = new TimelineDoc();
    docId = id;
    sessionStorage.setItem(CURRENT_DOC_KEY, id);
    await attach(id);

    selectedId = tldoc.titleEvent ? 'title' : (tldoc.entries[0]?.key ?? null);
    forkOf = listDrafts().find((d) => d.id === id)?.forkedFrom ?? null;
    view = 'editor';

    // A fork says what it is in a line that stays, not a dismissible note:
    // publishing is disabled here and will never be enabled, so the
    // explanation has to outlast a glance ([P10]). EditorView draws it.
    if (forkOf) return;

    // After the editor is up, not before: the comparison is two requests and
    // nothing about it should hold up opening a draft the author already has.
    void checkPublished('open');
    void assessForks();
  }

  // ── Reconciling with the published record ─────────────────────────────────────

  /**
   * Compare the open draft with the record it publishes over, and act.
   *
   * Runs on open and on a refused publish, and nowhere else: checking in the
   * background while a draft is open is useful and possible, but polling is its
   * own decision (docs/phase1-sync-conflicts.md, *Deliberately not decided
   * here*).
   *
   * Returns whether the author is now being asked something, so a publish that
   * triggered this can stop rather than reporting its own failure over the top
   * of the question.
   */
  async function checkPublished(occasion: 'open' | 'publish'): Promise<'clear' | 'asked'> {
    const uri = tldoc.atUri;
    if (!uri) return 'clear';

    // Script 8. No claim either way — the editor must not show "in sync" when
    // it has not checked, and must not invent a conflict either.
    if (auth.status !== 'signed-in') {
      syncNote = 'Signed out, so this could not be checked against the version in your account.';
      return 'clear';
    }

    // Before asking this account about it at all: a draft can belong to
    // another account, because one browser can hold work for more than one
    // identity. Nothing in this account's repo is evidence about that record,
    // and the Script 7 message below would be two wrong statements — that it
    // left an account it was never in, and that publishing would put it back,
    // when publishing offers to make a *new* timeline here instead.
    const owner = ownerOf(uri);
    if (owner && owner !== auth.session.sub) {
      // The handle is on the index entry, not in the document: it is about
      // the record this draft publishes to, not about its contents.
      const whose = drafts.find((d) => d.id === docId)?.ownerHandle;
      syncNote = `This timeline belongs to ${whose ? `“${whose}”` : 'another account'}, not to the account you are signed in as. `
        + 'Sign in as that account to publish changes to it, or publish this as a new timeline here.';
      return 'clear';
    }

    // One cheap request first: the list carries each record's CID, so the
    // common case — nothing changed — costs no content fetch at all.
    const listed = await listTimelines();
    const row = listed.find((r) => r.uri === uri);

    // Script 7. The record is gone; the draft stays and says so. Nothing is
    // deleted, and publishing will write it back.
    if (!row) {
      syncNote = 'This timeline is no longer in your account. Publishing will put it back.';
      return 'clear';
    }
    if (row.cid === tldoc.baseCid) return 'clear';

    const fetched = await getTimeline(uri);
    if (!fetched) {
      syncNote = 'The version in your account could not be read, so this was not compared against it.';
      return 'clear';
    }
    // The same normalization the editor applies to anything it imports, so the
    // two sides are matched on ids assigned the same way. `assignSlideIds` is
    // deterministic from the headline, so a slide both copies already hold
    // keeps one id across both.
    assignSlideIds(fetched.timeline);

    const outcome = reconcile({
      localClean: tldoc.clean,
      baseCid: tldoc.baseCid,
      publishedCid: row.cid,
      base: tldoc.publishedSnapshot,
      mine: tldoc.toTimeline(),
      published: fetched.timeline,
    });

    switch (outcome.kind) {
      case 'fast-forward': {
        // Script 3. Nothing local is at risk, so there is no decision to hand
        // over — but the content did change under them, so it is said, and
        // now it can be looked at.
        const before = tldoc.toTimeline();
        tldoc.adopt(outcome.published, outcome.published, row.cid);
        selectedId = tldoc.titleEvent ? 'title' : (tldoc.entries[0]?.key ?? null);
        const list = incomingList(before, tldoc.toTimeline());
        incoming = { entries: list.entries, reading: true };
        syncNote = `Updated to the version published from another browser. ${named(list.entries)}`;
        return 'clear';
      }
      case 'merged': {
        // [P9]. The two sides touched different things, so no field has two
        // values and there is nothing to choose between — but a change
        // arriving unseen and unundoable is its own surprise, so what landed
        // is named and can be put back a row at a time.
        const before = tldoc.toTimeline();
        tldoc.adopt(outcome.timeline, outcome.published, row.cid);
        selectedId = tldoc.titleEvent ? 'title' : (tldoc.entries[0]?.key ?? null);
        const list = incomingList(before, tldoc.toTimeline());
        incoming = { entries: list.entries, reading: false };
        syncNote = `${named(list.entries)} ${list.entries.length === 1 ? 'It is' : 'They are'} in this timeline now, alongside your own unpublished changes.`;
        return 'clear';
      }
      case 'conflict':
        conflict = {
          analysis: outcome.analysis,
          published: outcome.published ?? fetched.timeline,
          publishedCid: row.cid,
          ...(row.createdAt ? { publishedAt: row.createdAt } : {}),
          occasion,
        };
        return 'asked';
      default:
        return 'clear';
    }
  }

  /** *Keep mine*: the next publish overwrites the newer version knowingly. */
  function keepMine() {
    const c = conflict;
    if (!c) return;
    conflict = null;
    tldoc.rebase(c.published, c.publishedCid);
    syncNote = 'Keeping your version. Publishing will replace the one in your account.';
  }

  /** *Use the published version*: the local edits go. */
  function usePublished() {
    const c = conflict;
    if (!c) return;
    conflict = null;
    tldoc.adopt(c.published, c.published, c.publishedCid);
    selectedId = tldoc.titleEvent ? 'title' : (tldoc.entries[0]?.key ?? null);
    syncNote = 'Using the version from your account. Your unpublished changes are gone.';
  }

  /**
   * *Keep both*: this draft becomes a fork and the published version opens as
   * the working timeline.
   *
   * The draft that already exists becomes the fork, rather than the fork being
   * written as a new one. It is already persisted, it already holds the local
   * edits and their whole Yjs history, and the working document is the one with
   * the `atUri` — which is what the published version becomes. Inverting it
   * would mean building a second document by hand and hoping it reached storage
   * before being closed.
   */
  async function keepBoth(reconcile: boolean) {
    const c = conflict;
    if (!c) return;
    conflict = null;
    const forkId = docId;
    const uri = tldoc.atUri;
    const baseCid = tldoc.baseCid;
    const snapshot = tldoc.publishedSnapshot;

    if (forkId && uri && baseCid) {
      // No longer a claim on the record: [P4]'s one-draft-per-record invariant
      // must keep finding exactly one draft for this uri, and that is about to
      // be the new one.
      tldoc.setAtUri(null);
      noteDraft({
        id: forkId,
        title: tldoc.title,
        clean: false,
        forkedFrom: { atUri: uri, baseCid, baseSnapshot: JSON.stringify(snapshot ?? null) },
      });
    }

    const tl = c.published;
    await enterEditor({
      title: tldoc.title,
      titleSetByUser: tldoc.titleSetByUser,
      titleEvent: tl.title ?? null,
      events: tl.events,
      atUri: uri ?? undefined,
      baseCid: c.publishedCid,
      clean: true,
      settings: tl.settings,
    });
    // Straight into the pull-list when that is what was asked for. The fork is
    // already in `drafts` by now — `createDraft` relists them — so the same
    // lookup the editor's note uses finds it.
    await assessForks();
    if (reconcile) {
      await reviewFork();
      return;
    }
    // Said outright when this came from a refused publish, and said so that
    // it explains the tick rather than arguing with it: "Published ✓"
    // reappears in the subnav the moment this document adopts the record,
    // truthfully, because the document now *is* the record. Read straight
    // after pressing Publish, that looks like a receipt for the publish that
    // was just turned down — so the note names what the tick is about (this
    // timeline) and what it is not (anything of yours).
    syncNote = c.occasion === 'publish'
      ? 'Nothing of yours was published. You are now looking at the published version; your edits are kept as an unmerged draft, listed on the home screen under this timeline.'
      : 'Your edits are kept as an unmerged draft, listed on the home screen under this timeline.';
  }

  function dismissConflict() {
    conflict = null;
    syncNote = 'Left as it is. Publishing will be refused until this is settled.';
  }

  // ── What arrived ─────────────────────────────────────────────────────────────

  /**
   * The changes by name, for the note.
   *
   * "Merged 3 changes" tells someone that something happened to their
   * document and nothing about what — and the analysis that could have said
   * was computed and thrown away. Three names is the most a subnav line can
   * carry; past that it says how many more.
   */
  function named(entries: PullEntry[]): string {
    if (!entries.length) return 'Nothing changed that this timeline did not already have.';
    const names = entries.slice(0, 3).map((e) => e.label);
    const rest = entries.length - names.length;
    const list = names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const tail = rest ? `${list}, and ${rest} more` : list;
    return `${entries.length === 1 ? 'One change' : `${entries.length} changes`} published from another browser: ${tail}.`;
  }

  function reviewIncoming() {
    const list = incoming;
    if (!list) return;
    pull = {
      mode: list.reading ? 'arrived' : 'incoming',
      forkId: null,
      base: null,
      fork: null,
      entries: list.entries,
      unmatchable: 0,
    };
  }

  /** Put one incoming change back the way it was — an ordinary, undoable edit. */
  function putBack(entry: PullEntry) {
    applyPull(tldoc, entry);
    recomputeIncoming();
  }

  function putBackField(entry: PullEntry, key: string) {
    applyPullField(tldoc, entry, key);
    recomputeIncoming();
  }

  /**
   * Drop the rows that now match what they are offering.
   *
   * The same rule as the fork list — a row is gone once the document holds
   * its version — so putting a change back removes its row, and undoing that
   * brings the row back.
   */
  function recomputeIncoming() {
    if (!incoming) return;
    const working = tldoc.toTimeline();
    const entries = incoming.entries.filter((e) => outstanding(e, working));
    incoming = { ...incoming, entries };
    if (pull && pull.mode !== 'fork') pull = { ...pull, entries };
  }

  // ── Reconciling a fork ───────────────────────────────────────────────────────

  /**
   * Forks of the timeline that is open, which is what gives the editor
   * something to offer.
   *
   * A fork names the record it came from and holds no `atUri` of its own, so
   * this is the reverse of the lookup the home screen does to nest them.
   */
  const forksOfOpen = $derived(
    atUri && !forkOf ? drafts.filter((d) => d.forkedFrom?.atUri === atUri) : [],
  );

  /**
   * Read every fork of the open timeline and work out what it still has.
   *
   * Runs when a timeline is opened and after anything that could change the
   * answer, not continuously: the comparison is against the working document,
   * which moves on every keystroke, and a banner that flickered as you typed
   * would be worse than one that is a moment stale. A fork that cannot be
   * read, or was kept without its ancestor, counts as outstanding — the panel
   * is where that gets explained, and silence would hide the copy entirely.
   */
  async function assessForks() {
    const summaries = forksOfOpen;
    const working = tldoc.toTimeline();
    const offers = await Promise.all(
      summaries.map(async (summary) => {
        const base = summary.forkedFrom
          ? (JSON.parse(summary.forkedFrom.baseSnapshot) as TLTimeline | null)
          : null;
        const fork = await readDraftTimeline(summary.id);
        return {
          id: summary.id,
          base,
          fork,
          outstanding: base && fork ? pullList(base, fork, working).entries.length : 1,
        };
      }),
    );
    // Opening another draft while these reads were in flight would otherwise
    // leave the new timeline wearing the old one's forks.
    if (summaries !== forksOfOpen) return;
    forkOffers = offers;
  }

  /**
   * The timeline a fork came from, when this browser still has it.
   *
   * Without it there is nowhere to reconcile into: the record may exist in
   * the account, but the pull-list works against an open working document.
   */
  const forkParent = $derived.by(() => {
    const uri = forkOf?.atUri;
    if (!uri) return null;
    return drafts.find((d) => d.atUri === uri && !d.forkedFrom) ?? null;
  });

  /**
   * From inside a fork, go to the timeline it belongs to and open the
   * pull-list there.
   *
   * A fork could previously be opened and read but offered no way onward,
   * which left the reconciliation to be found by going back to the home
   * screen and guessing which row started it.
   */
  async function resolveFork() {
    const parent = forkParent;
    if (!parent) {
      syncNote = 'The timeline these edits came from is not in this browser, so there is nothing to sort them into. Open it from your account first.';
      return;
    }
    await openDraft(parent.id);
    await assessForks();
    await reviewFork();
  }

  /** Forks with something left to give, which is what the editor's line speaks for. */
  const forksOutstanding = $derived(forkOffers.filter((o) => o.outstanding > 0));
  /** Forks already worked through: nothing to bring across, only to delete. */
  const forksSettled = $derived(forkOffers.filter((o) => o.outstanding === 0));

  /**
   * Open the pull-list for a fork.
   *
   * More than one fork of a timeline is possible — *Keep both* twice — and
   * rare. They are reconciled one at a time, oldest first, because each pull
   * changes the working document and so changes what the next fork still has
   * to offer.
   */
  async function reviewFork() {
    const offer = forksOutstanding[0] ?? forkOffers[0];
    if (!offer) return;
    // Without the ancestor there is nothing to attribute changes to, and the
    // panel would be a two-way diff that cannot tell the author's own work
    // from the record's. Forks have carried it since they existed ([P11]).
    if (!offer.base) {
      syncNote = 'That draft was kept without the version it came from, so its edits cannot be told apart from this timeline\'s own. Open it and copy what you need across.';
      return;
    }
    if (!offer.fork) {
      syncNote = 'That draft could not be read from this browser\'s storage.';
      return;
    }
    pull = {
      mode: 'fork',
      forkId: offer.id,
      base: offer.base,
      fork: offer.fork,
      ...pullList(offer.base, offer.fork, tldoc.toTimeline()),
    };
  }

  /** Recompute from the fork already in hand — the working document moved, not it. */
  function recomputePull() {
    if (!pull?.fork || !pull.base) return;
    pull = { ...pull, ...pullList(pull.base, pull.fork, tldoc.toTimeline()) };
  }

  function bringOver(entry: PullEntry) {
    applyPull(tldoc, entry);
    recomputePull();
    void assessForks();
  }

  /**
   * Settle a row by keeping what this timeline has.
   *
   * The decision lives in the fork's recorded ancestor, which is why it has
   * to be written back to the draft index: it must survive a reload, and the
   * list itself remembers nothing. See `declinePull`.
   */
  function keepHere(entry: PullEntry) {
    const current = pull;
    if (!current?.fork || !current.base || !current.forkId) return;
    const base = declinePull(current.base, current.fork, entry);
    const summary = drafts.find((d) => d.id === current.forkId);
    if (!summary?.forkedFrom) return;
    noteDraft({
      ...summary,
      forkedFrom: { ...summary.forkedFrom, baseSnapshot: JSON.stringify(base) },
    });
    drafts = listDrafts();
    pull = { ...current, base, ...pullList(base, current.fork, tldoc.toTimeline()) };
    void assessForks();
  }

  /** One field of a row ([P6]) — the same transaction, assembled from both sides. */
  function bringField(entry: PullEntry, key: string) {
    applyPullField(tldoc, entry, key);
    recomputePull();
    void assessForks();
  }

  /**
   * The other half of that line: settle it the published way.
   *
   * `keepHere` for one field. Recorded in the ancestor the same way, so it
   * stays settled, and like `keepHere` it is not a document edit — Cmd-Z does
   * not bring the line back.
   */
  function keepPublishedField(entry: PullEntry, key: string) {
    const current = pull;
    if (!current?.fork || !current.base || !current.forkId) return;
    const base = declinePullField(current.base, current.fork, entry, key);
    const summary = drafts.find((d) => d.id === current.forkId);
    if (!summary?.forkedFrom) return;
    noteDraft({
      ...summary,
      forkedFrom: { ...summary.forkedFrom, baseSnapshot: JSON.stringify(base) },
    });
    drafts = listDrafts();
    pull = { ...current, base, ...pullList(base, current.fork, tldoc.toTimeline()) };
    void assessForks();
  }

  async function forgetFork() {
    const id = pull?.forkId;
    pull = null;
    if (!id) return;
    await forgetDraft(id);
    drafts = listDrafts();
    await assessForks();
    syncNote = 'The draft is deleted. Everything outstanding in it was settled first.';
  }

  /**
   * Delete the copies that have nothing left to give, from the editor's line.
   *
   * The pull-list offers this too, but reaching it means opening a panel that
   * would be empty — the one case where the panel has nothing to say that the
   * line has not said already.
   */
  async function forgetSettledForks() {
    const ids = forksSettled.map((o) => o.id);
    if (!ids.length) return;
    for (const id of ids) await forgetDraft(id);
    drafts = listDrafts();
    await assessForks();
    syncNote = ids.length === 1
      ? 'The draft is deleted. Nothing in it was outstanding.'
      : 'Those drafts are deleted. Nothing in them was outstanding.';
  }

  async function openFork() {
    const id = pull?.forkId;
    pull = null;
    if (id) await openDraft(id);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  onMount(() => {
    void (async () => {
      // Any draft left in the old single-slot key becomes a draft in the new
      // store. It throws only when the browser cannot store anything, in which
      // case the legacy key is deliberately left where it is.
      try {
        await migrateLegacyDraft();
      } catch (cause) {
        persistWarning = cause instanceof Error ? cause.message : String(cause);
      }
      drafts = listDrafts();

      // Documents whose deletion the last session did not outlive. Nothing in
      // the list can reach them; this is the storage they were still holding.
      void sweepPendingDeletions();

      // Returning from an OAuth redirect, reopen whatever was being edited.
      if (_startInEditor && _restoreDocId) await openDraft(_restoreDocId);
    })();

    void initAuth();
  });

  // ── Navigation ────────────────────────────────────────────────────────────────

  function uid(): string {
    return 'e' + Math.random().toString(36).slice(2, 9);
  }

  async function enterEditor(opts: { title?: string; titleSetByUser?: boolean; titleEvent?: TLEvent | null; events?: TLEvent[]; atUri?: string; baseCid?: string; clean?: boolean; settings?: TLSettings } = {}) {
    await createDraft(
      {
        ...(opts.titleEvent ? { title: opts.titleEvent } : {}),
        events: opts.events ?? [],
        settings: opts.settings ?? { ...DEFAULT_SETTINGS },
      },
      { title: opts.title, titleSetByUser: opts.titleSetByUser ?? false, atUri: opts.atUri, baseCid: opts.baseCid },
      { clean: opts.clean ?? true },
    );
  }

  async function goHome() {
    dismissDeletedItem();

    // An empty draft is not worth listing; anything with content stays, because
    // the document has already persisted itself and this is where it lives.
    const id = docId;
    const empty = !titleEvent && events.length === 0;
    if (id !== null && !empty) noteDraft({ id, title: timelineTitle, atUri: atUri ?? undefined, clean: pdsClean });

    await closeDraft();
    if (id !== null && empty) await forgetDraft(id);

    drafts = listDrafts();
    view = 'home';
  }

  async function handleSignOut() {
    // No confirmation about losing work any more: drafts persist locally on
    // their own and are listed on the home screen, so signing out costs the
    // session and nothing else. atUri stays on the document, which is what
    // links a draft back to the record it should overwrite when published again.
    if (view === 'editor') await goHome();
    void signOut();
  }

  // ── Home actions ─────────────────────────────────────────────────────────────

  // Nothing here asks "this will discard your current draft, continue?" any
  // more. Drafts coexist now, so starting or importing one costs nothing.

  async function handleNew() {
    await enterEditor();
  }

  async function handleImport(tl: TLTimeline) {
    // Legacy files (and older published records) can arrive with missing or illegal
    // slide IDs; normalize before they reach the editor rather than flagging them.
    assignSlideIds(tl);
    const te = tl.title ?? null;
    await enterEditor({ titleEvent: te, events: tl.events, clean: false, settings: tl.settings });
  }

  async function handleOpenRecord(
    uri: string,
    result: { title?: string; cid?: string; timeline: TLTimeline },
    opts: { replaceDraftId?: string } = {},
  ) {
    // Asked for the published copy in place of a local draft: that draft has
    // to go, or the next line would find it and reopen the very edits the
    // reader just chose to drop.
    if (opts.replaceDraftId) {
      await forgetDraft(opts.replaceDraftId);
      drafts = listDrafts();
    }

    // Reopen this record's existing draft rather than starting another one.
    // Every draft carries the `atUri` it would publish over, so two drafts of
    // one record are two claims on the same thing: whichever is opened last
    // wins the next publish, silently. The home screen asks before it gets
    // here when the draft has unpublished edits; this is the backstop that
    // keeps the one-draft-per-record invariant whatever the caller does, and
    // reads from the store so it cannot act on a stale copy of the list.
    const existing = listDrafts().find((d) => d.atUri === uri);
    if (existing) {
      await openDraft(existing.id);
      return;
    }

    const tl = result.timeline;
    assignSlideIds(tl);
    const te = tl.title ?? null;
    // The record's CID travels with its content: this draft agrees with that
    // version of it, and nothing later can establish which version it was.
    await enterEditor({ title: result.title, titleSetByUser: !!result.title, titleEvent: te, events: tl.events, atUri: uri, baseCid: result.cid, clean: true, settings: tl.settings });
  }

  async function handleOpenDraft(id: string) {
    await openDraft(id);
  }

  /**
   * Delete a draft, and with it any unmerged draft of it.
   *
   * An unmerged draft only means something next to the timeline it came from:
   * merging it needs that timeline open as the working document. Left behind,
   * it became a row nothing could ever be merged into, warning about a
   * timeline "above" that was no longer there. So the delete takes it too,
   * and the undo card says so.
   *
   * No confirmation. A question before the fact asks someone to predict what
   * they are about to lose; an undo card after it shows them. It is the
   * pattern a deleted slide already uses, and it suits this one for the same
   * reason: deleting a draft of a published timeline costs unpublished edits
   * and nothing else, which is a recoverable amount of wrong.
   *
   * Deliberately not deferral. The deletion really happens — the entries go
   * now and the documents follow when the window closes — because a deferred
   * deletion that the tab outlives is a thing the author asked for that
   * silently never happened. Undo restores instead of cancelling, and
   * `sweepPendingDeletions` finishes anything a closed tab interrupted.
   */
  function handleDeleteDraft(id: string, index: number) {
    // A second delete while a card is up commits the first rather than losing
    // track of it: one card, one offer.
    commitDeletedDrafts();
    const entries = removeDraftEntries(id);
    if (!entries.length) return;
    drafts = listDrafts();
    // The row's own position, passed by the list that drew it — the card goes
    // where the row was, so nothing below it moves.
    deletedDrafts = { entries, index };
    deletedDraftsLeaving = false;
    _draftUndoTimer = setTimeout(() => {
      // Fades where it stands first, so the list does not jump while someone
      // is still looking at it.
      deletedDraftsLeaving = true;
      _draftUndoTimer = setTimeout(commitDeletedDrafts, 350);
    }, UNDO_WINDOW);
  }

  /** Let the deletion through: the documents go, and the card with them. */
  function commitDeletedDrafts() {
    if (_draftUndoTimer !== null) { clearTimeout(_draftUndoTimer); _draftUndoTimer = null; }
    const pending = deletedDrafts;
    deletedDrafts = null;
    deletedDraftsLeaving = false;
    if (pending) void commitDraftDeletions(pending.entries);
  }

  /** Put the draft back, documents untouched because they were never dropped. */
  function undoDeleteDraft() {
    if (_draftUndoTimer !== null) { clearTimeout(_draftUndoTimer); _draftUndoTimer = null; }
    const pending = deletedDrafts;
    deletedDrafts = null;
    deletedDraftsLeaving = false;
    if (!pending) return;
    restoreDraftEntries(pending.entries);
    drafts = listDrafts();
  }

  // ── Editor actions ────────────────────────────────────────────────────────────

  function addEvent() {
    selectedId = tldoc.addEvent({ unique_id: uid() });
  }

  function addTitleSlide() {
    tldoc.setTitleSlide({ unique_id: 'title' });
    selectedId = 'title';
  }

  function updateEvent(updated: TLEvent) {
    // No special case for a rename any more: `unique_id` is an ordinary field
    // and a slide's identity does not move when it changes.
    if (selectedId !== null) tldoc.updateEvent(selectedId, updated);
  }

  function deleteEvent(key: string) {
    // A capture boundary either side makes the deletion a stack item of its own.
    // Without one, deleting within half a second of an edit merges into that
    // edit, and restoring the slide would revert the edit as well.
    tldoc.captureBoundary();
    if (key === 'title') {
      const event = titleEvent!;
      tldoc.removeTitleSlide();
      deletedItem = { event, isTitle: true, sortedIndex: -1, stackItem: tldoc.latestUndoItem() };
      selectedId = tldoc.entries[0]?.key ?? null;
    } else {
      const sortedIndex = tldoc.entries.findIndex(e => e.key === key);
      const event = tldoc.eventForKey(key)!;
      tldoc.removeEvent(key);
      deletedItem = { event, isTitle: false, sortedIndex, stackItem: tldoc.latestUndoItem() };
      if (selectedId === key) {
        const remaining = tldoc.entries;
        selectedId = remaining.length > 0 ? remaining[remaining.length - 1].key : null;
      }
    }
    tldoc.captureBoundary();
    deletedItemLeaving = false;
    if (_undoTimer !== null) clearTimeout(_undoTimer);
    _undoTimer = setTimeout(() => {
      deletedItemLeaving = true;
      _undoTimer = setTimeout(() => { deletedItem = null; deletedItemLeaving = false; _undoTimer = null; }, 350);
    }, 4650);
  }

  function updateSettings(patch: Partial<TLSettings>) {
    tldoc.patchSettings(patch);
  }

  /** Take down the restore row and stop its countdown. */
  function dismissDeletedItem() {
    if (_undoTimer !== null) { clearTimeout(_undoTimer); _undoTimer = null; }
    deletedItem = null;
    deletedItemLeaving = false;
  }

  function undoDelete() {
    if (!deletedItem) return;
    if (_undoTimer !== null) { clearTimeout(_undoTimer); _undoTimer = null; }
    deletedItemLeaving = false;
    const { event, isTitle, stackItem } = deletedItem;
    deletedItem = null;

    // Still the next thing undo would do? Then restore through undo itself: the
    // slide returns under its original key, gets revealed and flashed (D7), and
    // history stays truthful.
    if (stackItem && tldoc.isNextUndo(stackItem)) {
      requestHistory('undo');
      return;
    }

    // Otherwise other edits have happened since. Re-add the slide as a new one,
    // and drop the deletion from history — or Cmd-Z could later bring the
    // original back as well, leaving two copies.
    if (stackItem) tldoc.forgetUndoItem(stackItem);
    if (isTitle) {
      tldoc.setTitleSlide(event);
      selectedId = 'title';
    } else {
      selectedId = tldoc.addEvent(event);
    }
  }

  // Clear "Published ✓" as soon as the data is dirtied; errors auto-dismiss separately
  $effect(() => { if (!pdsClean) publishStatus = null; });

  /** A fork holds no claim on a record, so it cannot publish until that is settled ([P10]). */
  const canPublishHere = $derived(canPublish && !forkOf);

  function handleTitleChange(t: string) {
    tldoc.setTitle(t, t.trim() !== '');
  }

  async function handlePublish() {
    // A cached draft's atUri can point at a record owned by a different
    // account than the one currently signed in (e.g. sign out, then sign
    // back in as someone else and restore the draft). Reusing that rkey
    // wouldn't overwrite the original record — it would silently write a
    // new one under the current account — so ask instead of guessing.
    if (atUri && auth.status === 'signed-in') {
      const ownerDid = atUri.split('/')[2];
      if (ownerDid && ownerDid !== auth.session.sub) {
        const publishAsNew = window.confirm(
          'This timeline was published under a different account. Publish it as a new timeline in your current account?'
        );
        if (!publishAsNew) return;
        tldoc.setAtUri(null);
      }
    }

    // An unmerged draft is not part of what goes out, and the moment it is
    // easiest to believe otherwise is this one. It is said here rather than
    // afterwards because the point of saying it is the decision, not the
    // record of one — and only while something in that draft is still
    // outstanding, so a draft already worked through is silent.
    if (forksOutstanding.length) {
      const anyway = window.confirm(
        'This publishes the timeline as it stands. Your unmerged draft is not part of it, and stays where it is.\n\nPublish anyway?'
      );
      if (!anyway) return;
    }

    publishStatus = 'Publishing…';
    publishTone = 'ok';

    // Auto-generate a share-preview poster from the current title slide.
    // Best-effort: on any failure, keep whatever ogImage already existed
    // rather than losing it over a transient generation/upload error.
    let ogImage = settings.ogImage;
    // A reference that cannot be read is let go of here rather than carried
    // along. `publishTimeline` drops it from the record anyway, so keeping it
    // in the document would leave the draft and its own record permanently
    // disagreeing about the settings — which is how the broken reference
    // announced itself: as "and the settings" in every conflict dialog.
    if (ogImage && !extractCid(ogImage.blobRef?.ref)) ogImage = undefined;
    try {
      const poster = await generatePoster(timeline);
      if (poster) {
        ogImage = { blobRef: await uploadBlob(poster) };
      }
    } catch {
      // best-effort, see above
    }
    const timelineToPublish: TLTimeline = { ...timeline, settings: { ...settings, ogImage } };

    const result = await publishTimeline(timelineToPublish, { title: timelineTitle }, atUri ?? undefined, tldoc.baseCid ?? undefined);
    if (result.ok) {
      tldoc.setAtUri(result.uri);
      // What went out, before recording that it did: the poster is generated
      // here and uploaded, so without this the document never learns which
      // share image its own record holds.
      tldoc.recordPublishedSettings({ ogImage });
      // The CID the PDS just minted, recorded with the snapshot it describes.
      tldoc.markClean(result.cid);
      publishStatus = 'Published ✓';
      // Whatever the last reconciliation had to say, publishing is the thing
      // it was asking for — "publish again to include your own" outlives its
      // usefulness the moment they do.
      syncNote = null;
    } else if (result.conflict) {
      // The write was refused, not failed: something published over this
      // record since this draft last agreed with it, and the PDS declined to
      // let that work be overwritten. Nothing here is lost — the draft is
      // untouched and still holds everything.
      //
      // Script 6. The same comparison as Script 5, which may merge the two
      // sides on its own; only a real collision reaches the author, and then
      // the dialog says what did not happen, so the status line does not
      // repeat it underneath.
      publishStatus = null;
      const asked = await checkPublished('publish');
      if (asked === 'clear' && !syncNote) {
        publishStatus = 'Not published: this timeline changed in your account since you last loaded it.';
        publishTone = 'warn';
      }
    } else {
      publishStatus = `Publish failed: ${result.error}`;
      publishTone = 'warn';
      setTimeout(() => { publishStatus = null; }, 4000);
    }
  }

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(timeline, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = slugify(timelineTitle) || 'timeline';
    const date = new Date().toISOString().split('T')[0];
    a.download = `${slug}-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // CSV can only carry plain URLs — swap any blobRef-backed media/background
  // for its durable PDS blob URL (not the local preview blob: URL some
  // in-progress uploads carry) so uploaded images survive the round trip.
  function resolveBlobRefsForExport(ev: TLEvent): TLEvent {
    const mediaCid = ev.media?.blobRef ? extractCid(ev.media.blobRef.ref) : '';
    const bgCid = ev.background?.blobRef ? extractCid(ev.background.blobRef.ref) : '';
    return {
      ...ev,
      ...(mediaCid ? { media: { ...ev.media, url: blobUrl(mediaCid) } } : {}),
      ...(bgCid ? { background: { ...ev.background, url: blobUrl(bgCid) } } : {}),
    };
  }

  function handleExportCSV() {
    const csvTimeline: TLTimeline = {
      ...(titleEvent ? { title: resolveBlobRefsForExport(titleEvent) } : {}),
      events: sortedEvents.map(resolveBlobRefsForExport),
    };
    const blob = new Blob([toTL3CSV(csvTimeline)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = slugify(timelineTitle) || 'timeline';
    const date = new Date().toISOString().split('T')[0];
    a.download = `${slug}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

{#if view === 'home'}
  <HomeView
    {drafts}
    {persistWarning}
    onopendraft={handleOpenDraft}
    ondeletedraft={handleDeleteDraft}
    {deletedDrafts}
    {deletedDraftsLeaving}
    onundodeletedraft={undoDeleteDraft}
    onforgetdraft={(id) => { void forgetDraftWithForks(id).then(() => { drafts = listDrafts(); }); }}
    onnew={handleNew}
    onimport={handleImport}
    onopen={handleOpenRecord}
    onsignout={handleSignOut}
  />
{:else}
  <EditorView
    {timelineTitle}
    {titleEvent}
    entries={tldoc.entries}
    {selectedId}
    {selectedEvent}
    {isEditingTitle}
    {timeline}
    {atUri}
    {pdsClean}
    {publishStatus}
    {publishTone}
    onreviewincoming={incoming?.entries.length ? reviewIncoming : null}
    forkCount={forksOutstanding.length}
    settledForkCount={forksSettled.length}
    onreviewfork={reviewFork}
    onforgetsettledforks={forgetSettledForks}
    forkParentTitle={forkOf ? (forkParent?.title ?? null) : null}
    isFork={!!forkOf}
    onresolvefork={resolveFork}
    canPublish={canPublishHere}
    {syncNote}
    ondismissnote={() => (syncNote = null)}
    {deletedItem}
    {deletedItemLeaving}
    {settings}
    {headlineFragment}
    {bodyFragment}
    onback={goHome}
    onsignout={handleSignOut}
    ontitlechange={handleTitleChange}
    onselect={(id) => (selectedId = id)}
    onadd={addEvent}
    onaddtitle={addTitleSlide}
    ondelete={deleteEvent}
    onupdate={updateEvent}
    onpublish={handlePublish}
    onexport={handleExport}
    onexportcsv={handleExportCSV}
    onundo={undoDelete}
    onsettingschange={updateSettings}
    onpeekhistory={(direction) => (direction === 'undo' ? tldoc.peekUndo() : tldoc.peekRedo())}
    onapplyhistory={(direction) => {
      const pendingDeletion = deletedItem?.stackItem ?? null;
      const changed = direction === 'undo' ? tldoc.undo() : tldoc.redo();
      if (!changed) return false;
      historyVersion += 1;
      // A pull is an ordinary undoable edit, so undoing one puts the row back
      // on offer. Neither the open panel nor the subnav line watches the
      // document, so both are told here — without this, undo left the list
      // claiming a row had been dealt with.
      recomputePull();
      void assessForks();
      // Undo has just brought the slide back itself, so the restore row is
      // offering to do it again — and clicking it would leave a second copy.
      if (pendingDeletion && !tldoc.hasUndoItem(pendingDeletion)) dismissDeletedItem();
      return true;
    }}
    {historyVersion}
  />
{/if}

{#if pull}
  <!--
    `loading` is about reading a fork out of its own database, which is the
    only mode that does it — an incoming list is computed from the document
    already open. Tested as `fork === null` alone, every incoming panel
    reported itself as still loading, because a null fork is that mode's
    normal state, and so showed nothing at all.
  -->
  <ForkPullList
    mode={pull.mode}
    entries={pull.entries}
    unmatchable={pull.unmatchable}
    loading={pull.mode === 'fork' && pull.fork === null}
    onbring={pull.mode === 'fork' ? bringOver : putBack}
    onbringfield={pull.mode === 'fork' ? bringField : putBackField}
    onkeephere={keepHere}
    onkeeppublishedfield={keepPublishedField}
    onforget={forgetFork}
    onopenfork={openFork}
    onclose={() => (pull = null)}
  />
{/if}

{#if conflict}
  <ConflictChoice
    analysis={conflict.analysis}
    occasion={conflict.occasion}
    publishedAt={conflict.publishedAt}
    onkeepmine={keepMine}
    onusepublished={usePublished}
    onkeepboth={keepBoth}
    ondismiss={dismissConflict}
  />
{/if}
