<script lang="ts">
  import { onMount } from 'svelte';
  import type { TLEvent, TLTimeline, TLSettings } from '@knight-lab/timeline-ng-core';
  import { parseTLDate, compareDates } from '@knight-lab/timeline-ng-core';
  import { getAuthState, saveTimeline, signOut, uploadBlob } from './lib/atproto.svelte.ts';
  import { initAuth } from './lib/atproto.svelte.ts';
  import { generatePoster } from './lib/poster.ts';
  import { saveDraft, loadDraft, clearDraft } from './lib/draft.ts';
  import type { Draft } from './lib/draft.ts';
  import HomeView from './components/HomeView.svelte';
  import EditorView from './components/EditorView.svelte';

  // ── Synchronous OAuth restore check (must run before first render) ───────────

  const _restoreFlag = sessionStorage.getItem('tl-post-auth-restore');
  const _restoreView = sessionStorage.getItem('tl-post-auth-view');
  const _restoreDraft = _restoreFlag ? loadDraft() : null;
  const _startInEditor = _restoreFlag === '1' && _restoreView === 'editor';
  if (_restoreFlag) {
    sessionStorage.removeItem('tl-post-auth-restore');
    sessionStorage.removeItem('tl-post-auth-view');
  }

  // ── View ─────────────────────────────────────────────────────────────────────

  let view = $state<'home' | 'editor'>(_startInEditor ? 'editor' : 'home');

  // ── Editor state ─────────────────────────────────────────────────────────────

  const DEFAULT_SETTINGS: TLSettings = { language: 'en', theme: 'auto', initialIndex: 0, reverseOrder: false };

  let timelineTitle = $state(_restoreDraft?.title ?? '');
  let titleSetByUser = $state(false);
  let titleEvent = $state<TLEvent | null>(_restoreDraft?.titleEvent ?? null);
  let events = $state<TLEvent[]>(_startInEditor ? (_restoreDraft?.events ?? []) : []);
  let selectedId = $state<string | null>(_startInEditor ? (_restoreDraft?.titleEvent ? 'title' : (_restoreDraft?.events?.[0]?.unique_id ?? null)) : null);
  let atUri = $state<string | null>(_restoreDraft?.atUri ?? null);
  let pdsClean = $state(_startInEditor ? (_restoreDraft?.pdsClean ?? true) : true);
  let saveStatus = $state<string | null>(null);
  let settings = $state<TLSettings>(_restoreDraft?.settings ?? { ...DEFAULT_SETTINGS });

  // ── Draft ────────────────────────────────────────────────────────────────────

  let pendingDraft = $state<Draft | null>(null);
  let deletedItem = $state<{ event: TLEvent; isTitle: boolean; sortedIndex: number } | null>(null);
  let deletedItemLeaving = $state(false);
  let _undoTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Derived ──────────────────────────────────────────────────────────────────

  const auth = $derived(getAuthState());

  const sortedEvents = $derived(
    [...events].sort((a, b) => {
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return compareDates(parseTLDate(a.start_date), parseTLDate(b.start_date));
    })
  );

  const timeline = $derived<TLTimeline>({
    ...(titleEvent ? { title: titleEvent } : {}),
    events: sortedEvents,
    settings,
  });

  const selectedEvent = $derived.by<TLEvent | null>(() => {
    if (selectedId === 'title') return titleEvent;
    return events.find((e) => e.unique_id === selectedId) ?? null;
  });

  const isEditingTitle = $derived(selectedId === 'title');

  const canSave = $derived(auth.status === 'signed-in' && (events.length > 0 || !!titleEvent));

  // ── Autosave to localStorage ──────────────────────────────────────────────────

  let _draftTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (view !== 'editor') return;
    const t = timelineTitle;
    const te = titleEvent;
    const ev = events;
    const uri = atUri;
    const st = settings;
    const clean = pdsClean;

    if (_draftTimer !== null) clearTimeout(_draftTimer);

    // Clean means the editor matches the last save (or load) — nothing to protect
    // against a crash/reload, so there's no reason to keep a local draft around.
    if (clean) {
      clearDraft();
      return;
    }

    _draftTimer = setTimeout(() => {
      _draftTimer = null;
      saveDraft({ title: t || undefined, titleEvent: te, events: ev, atUri: uri ?? undefined, settings: st });
    }, 600);

    return () => {
      if (_draftTimer !== null) { clearTimeout(_draftTimer); _draftTimer = null; }
    };
  });


  // Auto-sync title from title slide headline when user hasn't set one explicitly
  $effect(() => {
    if (!titleSetByUser) {
      timelineTitle = titleEvent?.text?.headline?.replace(/<[^>]*>/g, '').trim() ?? '';
    }
  });

  // ── Init ─────────────────────────────────────────────────────────────────────

  onMount(() => {
    const draft = loadDraft();
    if (draft && (draft.events.length > 0 || draft.titleEvent)) {
      pendingDraft = draft;
    }

    void initAuth();

    const flush = () => {
      if (view === 'editor' && !pdsClean) {
        saveDraft({ title: timelineTitle || undefined, titleEvent, events, atUri: atUri ?? undefined, settings });
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  });

  // ── Navigation ────────────────────────────────────────────────────────────────

  function uid(): string {
    return 'e' + Math.random().toString(36).slice(2, 9);
  }

  function enterEditor(opts: { title?: string; titleSetByUser?: boolean; titleEvent?: TLEvent | null; events?: TLEvent[]; atUri?: string; clean?: boolean; settings?: TLSettings } = {}) {
    titleSetByUser = opts.titleSetByUser ?? false;
    timelineTitle = opts.title ?? '';
    titleEvent = opts.titleEvent ?? null;
    events = opts.events ?? [];
    atUri = opts.atUri ?? null;
    selectedId = opts.titleEvent ? 'title' : (opts.events?.[0]?.unique_id ?? null);
    pdsClean = opts.clean ?? true;
    settings = opts.settings ?? { ...DEFAULT_SETTINGS };
    view = 'editor';
  }

  function goHome() {
    if (_undoTimer !== null) { clearTimeout(_undoTimer); _undoTimer = null; }
    deletedItem = null;
    deletedItemLeaving = false;
    if (!pdsClean && (titleEvent || events.length > 0)) {
      const draft: Draft = { title: timelineTitle || undefined, titleEvent, events, atUri: atUri ?? undefined, pdsClean, settings };
      saveDraft(draft);
      pendingDraft = draft;
    } else {
      clearDraft();
      pendingDraft = null;
    }
    view = 'home';
  }

  function handleSignOut() {
    const hasContent = view === 'editor'
      ? (!!titleEvent || events.length > 0)
      : !!(pendingDraft && (pendingDraft.events.length > 0 || pendingDraft.titleEvent));
    if (hasContent && !window.confirm('Your timeline is only saved in this browser. Sign out anyway?')) return;
    if (view === 'editor') {
      // atUri belongs to the signed-in account — clear it so the drawer
      // doesn't show stale "saved" state after logout.
      atUri = null;
      pdsClean = false;
      goHome();
    }
    void signOut();
  }

  // ── Home actions ─────────────────────────────────────────────────────────────

  function hasPendingContent() {
    return !!(pendingDraft && (pendingDraft.events.length > 0 || pendingDraft.titleEvent));
  }

  function handleNew() {
    if (hasPendingContent() && !window.confirm('Starting a new timeline will discard your current draft. Continue?')) return;
    clearDraft();
    pendingDraft = null;
    enterEditor();
  }

  function handleImport(tl: TLTimeline) {
    if (hasPendingContent() && !window.confirm('Importing will discard your current draft. Continue?')) return;
    clearDraft();
    pendingDraft = null;
    const evs = tl.events.map(ev => ev.unique_id ? ev : { ...ev, unique_id: uid() });
    const te = tl.title ? { unique_id: 'title', ...tl.title } : null;
    enterEditor({ titleEvent: te, events: evs, clean: false, settings: tl.settings });
  }

  function handleOpenRecord(uri: string, result: { title?: string; timeline: TLTimeline }) {
    if (hasPendingContent() && !window.confirm('Opening this timeline will discard your current draft. Continue?')) return;
    clearDraft();
    pendingDraft = null;
    const tl = result.timeline;
    const evs = tl.events.map(ev => ev.unique_id ? ev : { ...ev, unique_id: uid() });
    const te = tl.title ? { unique_id: 'title', ...tl.title } : null;
    enterEditor({ title: result.title, titleSetByUser: !!result.title, titleEvent: te, events: evs, atUri: uri, clean: true, settings: tl.settings });
  }

  function handleRestoreDraft() {
    const draft = pendingDraft!;
    pendingDraft = null;
    enterEditor({
      title: draft.title,
      titleSetByUser: !!draft.title,
      titleEvent: draft.titleEvent,
      events: draft.events,
      atUri: draft.atUri,
      clean: !draft.atUri,
      settings: draft.settings,
    });
  }

  function handleDiscardDraft() {
    clearDraft();
    pendingDraft = null;
  }

  // ── Editor actions ────────────────────────────────────────────────────────────

  function addEvent() {
    pdsClean = false;
    const id = uid();
    events = [...events, { unique_id: id }];
    selectedId = id;
  }

  function addTitleSlide() {
    pdsClean = false;
    titleEvent = { unique_id: 'title' };
    selectedId = 'title';
  }

  function updateEvent(updated: TLEvent) {
    pdsClean = false;
    if (selectedId === 'title') {
      titleEvent = updated;
    } else {
      // Match on the id the event had *before* this update, not updated.unique_id —
      // when a rename is in the update, updated.unique_id is the new value, which
      // won't match anything in the array yet.
      events = events.map(e => e.unique_id === selectedId ? updated : e);
      if (updated.unique_id && updated.unique_id !== selectedId) {
        selectedId = updated.unique_id;
      }
    }
  }

  function deleteEvent(id: string) {
    pdsClean = false;
    if (id === 'title') {
      deletedItem = { event: titleEvent!, isTitle: true, sortedIndex: -1 };
      titleEvent = null;
      selectedId = events[0]?.unique_id ?? null;
    } else {
      const sortedIndex = sortedEvents.findIndex(e => e.unique_id === id);
      deletedItem = { event: events.find(e => e.unique_id === id)!, isTitle: false, sortedIndex };
      events = events.filter(e => e.unique_id !== id);
      if (selectedId === id) {
        selectedId = events.length > 0 ? events[events.length - 1].unique_id! : null;
      }
    }
    deletedItemLeaving = false;
    if (_undoTimer !== null) clearTimeout(_undoTimer);
    _undoTimer = setTimeout(() => {
      deletedItemLeaving = true;
      _undoTimer = setTimeout(() => { deletedItem = null; deletedItemLeaving = false; _undoTimer = null; }, 350);
    }, 4650);
  }

  function updateSettings(patch: Partial<TLSettings>) {
    pdsClean = false;
    settings = { ...settings, ...patch };
  }

  function undoDelete() {
    if (!deletedItem) return;
    if (_undoTimer !== null) { clearTimeout(_undoTimer); _undoTimer = null; }
    deletedItemLeaving = false;
    const { event, isTitle } = deletedItem;
    deletedItem = null;
    if (isTitle) {
      titleEvent = event;
      selectedId = 'title';
    } else {
      events = [...events, event];
      selectedId = event.unique_id!;
    }
  }

  // Clear "Saved ✓" as soon as the data is dirtied; errors auto-dismiss separately
  $effect(() => { if (!pdsClean) saveStatus = null; });

  function handleTitleChange(t: string) {
    timelineTitle = t;
    titleSetByUser = t.trim() !== '';
  }

  async function handleSave() {
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
      atUri = result.uri;
      pdsClean = true;
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
</script>

{#if view === 'home'}
  <HomeView
    {pendingDraft}
    onrestore={handleRestoreDraft}
    ondiscard={handleDiscardDraft}
    onnew={handleNew}
    onimport={handleImport}
    onopen={handleOpenRecord}
    onsignout={handleSignOut}
  />
{:else}
  <EditorView
    {timelineTitle}
    {titleEvent}
    {sortedEvents}
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
    onundo={undoDelete}
    onsettingschange={updateSettings}
  />
{/if}
