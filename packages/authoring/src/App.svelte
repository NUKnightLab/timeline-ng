<script lang="ts">
  import { onMount } from 'svelte';
  import type { TLEvent, TLTimeline, TLSettings } from '@knight-lab/timeline-ng-core';
  import { toTL3CSV, assignSlideIds } from '@knight-lab/timeline-ng-core';
  import { getAuthState, saveTimeline, signOut, uploadBlob, blobUrl, extractCid } from './lib/atproto.svelte.ts';
  import { initAuth } from './lib/atproto.svelte.ts';
  import { generatePoster } from './lib/poster.ts';
  import { listDrafts, newDocId, noteDraft, forgetDraft, persistDoc } from './lib/localStore.ts';
  import type { DraftSummary } from './lib/localStore.ts';
  import { migrateLegacyDraft } from './lib/draftMigration.ts';
  import type { IndexeddbPersistence } from 'y-indexeddb';
  import { TimelineDoc, HEADLINE_FIELD, BODY_FIELD } from './lib/doc.svelte.ts';
  import { requestHistory } from './lib/historyBus.ts';
  import { stripHtml } from './lib/text.ts';
  import HomeView from './components/HomeView.svelte';
  import EditorView from './components/EditorView.svelte';

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
  let saveStatus = $state<string | null>(null);
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
  let deletedItemLeaving = $state(false);
  let _undoTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ──────────────────────────────────────────────────────────────────

  const auth = $derived(getAuthState());

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

  const canSave = $derived(auth.status === 'signed-in' && (events.length > 0 || !!titleEvent));

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
    void settings;

    if (_indexTimer !== null) clearTimeout(_indexTimer);
    if (!hasContent) return;

    _indexTimer = setTimeout(() => {
      _indexTimer = null;
      noteDraft({ id, title, atUri: uri ?? undefined });
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
    meta: { title?: string; titleSetByUser?: boolean; atUri?: string },
    opts: { clean?: boolean } = {},
  ) {
    await closeDraft();
    tldoc = new TimelineDoc();
    tldoc.load(timeline, meta, opts);

    const id = newDocId();
    docId = id;
    sessionStorage.setItem(CURRENT_DOC_KEY, id);
    await attach(id);
    noteDraft({ id, title: tldoc.title, atUri: meta.atUri });
    drafts = listDrafts();

    selectedId = tldoc.titleEvent ? 'title' : (tldoc.entries[0]?.key ?? null);
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
    view = 'editor';
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

      // Returning from an OAuth redirect, reopen whatever was being edited.
      if (_startInEditor && _restoreDocId) await openDraft(_restoreDocId);
    })();

    void initAuth();
  });

  // ── Navigation ────────────────────────────────────────────────────────────────

  function uid(): string {
    return 'e' + Math.random().toString(36).slice(2, 9);
  }

  async function enterEditor(opts: { title?: string; titleSetByUser?: boolean; titleEvent?: TLEvent | null; events?: TLEvent[]; atUri?: string; clean?: boolean; settings?: TLSettings } = {}) {
    await createDraft(
      {
        ...(opts.titleEvent ? { title: opts.titleEvent } : {}),
        events: opts.events ?? [],
        settings: opts.settings ?? { ...DEFAULT_SETTINGS },
      },
      { title: opts.title, titleSetByUser: opts.titleSetByUser ?? false, atUri: opts.atUri },
      { clean: opts.clean ?? true },
    );
  }

  async function goHome() {
    if (_undoTimer !== null) { clearTimeout(_undoTimer); _undoTimer = null; }
    deletedItem = null;
    deletedItemLeaving = false;

    // An empty draft is not worth listing; anything with content stays, because
    // the document has already persisted itself and this is where it lives.
    const id = docId;
    const empty = !titleEvent && events.length === 0;
    if (id !== null && !empty) noteDraft({ id, title: timelineTitle, atUri: atUri ?? undefined });

    await closeDraft();
    if (id !== null && empty) await forgetDraft(id);

    drafts = listDrafts();
    view = 'home';
  }

  async function handleSignOut() {
    // No confirmation about losing work any more: drafts persist locally on
    // their own and are listed on the home screen, so signing out costs the
    // session and nothing else. atUri stays on the document, which is what
    // links a draft back to the record it should overwrite when saved again.
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
    // Legacy files (and older saved records) can arrive with missing or illegal
    // slide IDs; normalize before they reach the editor rather than flagging them.
    assignSlideIds(tl);
    const te = tl.title ?? null;
    await enterEditor({ titleEvent: te, events: tl.events, clean: false, settings: tl.settings });
  }

  async function handleOpenRecord(uri: string, result: { title?: string; timeline: TLTimeline }) {
    const tl = result.timeline;
    assignSlideIds(tl);
    const te = tl.title ?? null;
    await enterEditor({ title: result.title, titleSetByUser: !!result.title, titleEvent: te, events: tl.events, atUri: uri, clean: true, settings: tl.settings });
  }

  async function handleOpenDraft(id: string) {
    await openDraft(id);
  }

  async function handleDeleteDraft(id: string) {
    const draft = drafts.find((d) => d.id === id);
    const name = draft?.title ? `"${draft.title}"` : 'this untitled draft';
    if (!window.confirm(`Delete ${name} from this browser? Anything already published stays published.`)) return;
    await forgetDraft(id);
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

  // Clear "Saved ✓" as soon as the data is dirtied; errors auto-dismiss separately
  $effect(() => { if (!pdsClean) saveStatus = null; });

  function handleTitleChange(t: string) {
    tldoc.setTitle(t, t.trim() !== '');
  }

  async function handleSave() {
    // A cached draft's atUri can point at a record owned by a different
    // account than the one currently signed in (e.g. sign out, then sign
    // back in as someone else and restore the draft). Reusing that rkey
    // wouldn't overwrite the original record — it would silently write a
    // new one under the current account — so ask instead of guessing.
    if (atUri && auth.status === 'signed-in') {
      const ownerDid = atUri.split('/')[2];
      if (ownerDid && ownerDid !== auth.session.sub) {
        const saveAsNew = window.confirm(
          'This timeline was saved under a different account. Save it as a new timeline in your current account?'
        );
        if (!saveAsNew) return;
        tldoc.setAtUri(null);
      }
    }

    saveStatus = 'Saving…';

    // Auto-generate a share-preview poster from the current title slide.
    // Best-effort: on any failure, keep whatever ogImage already existed
    // rather than losing it over a transient generation/upload error.
    let ogImage = settings.ogImage;
    try {
      const poster = await generatePoster(timeline);
      if (poster) {
        ogImage = { blobRef: await uploadBlob(poster) };
      }
    } catch {
      // best-effort, see above
    }
    const timelineToSave: TLTimeline = { ...timeline, settings: { ...settings, ogImage } };

    const result = await saveTimeline(timelineToSave, { title: timelineTitle }, atUri ?? undefined);
    if (result.ok) {
      tldoc.setAtUri(result.uri);
      tldoc.markClean();
      saveStatus = 'Saved ✓';
    } else {
      saveStatus = `Save failed: ${result.error}`;
      setTimeout(() => { saveStatus = null; }, 4000);
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
    {saveStatus}
    {canSave}
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
    onsave={handleSave}
    onexport={handleExport}
    onexportcsv={handleExportCSV}
    onundo={undoDelete}
    onsettingschange={updateSettings}
    onpeekhistory={(direction) => (direction === 'undo' ? tldoc.peekUndo() : tldoc.peekRedo())}
    onapplyhistory={(direction) => {
      const changed = direction === 'undo' ? tldoc.undo() : tldoc.redo();
      if (changed) historyVersion += 1;
      return changed;
    }}
    {historyVersion}
  />
{/if}
