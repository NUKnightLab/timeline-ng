<script lang="ts">
  import { fromTL3, fromTL3CSV, normalizeTimelineSourceUrl, parseTimelineText } from '@knight-lab/timeline-ng-core';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';
  import type { DraftSummary } from '../lib/localStore.ts';
  import { orphanForks, timelineRows } from '../lib/timelineRows.ts';
  import type { TimelineRecord, TimelineRow } from '../lib/timelineRows.ts';
  import { getAuthState, listTimelines, getTimeline, deleteTimeline } from '../lib/atproto.svelte.ts';
  import AppNavbar from './AppNavbar.svelte';
  import AuthButton from './AuthButton.svelte';
  import { SlidePlayer, loadTimeline } from '@knight-lab/timeline-ng';

  // If this record is ever lost (e.g. accidentally deleted), restore its
  // content from packages/authoring/demo-timeline-backup.json via "FROM FILE".
  // Settings won't come back that way (the TL3 import path only restores
  // title/events) and ogImage isn't backed up — it regenerates on next publish.
  const DEMO_URI = 'at://did:plc:xcinm6zyywmiymjyz67qgm72/com.knightlab.timeline/mr6t86qd66rf';

  let demoTimeline = $state<TLTimeline | null>(null);
  let demoError = $state<string | null>(null);

  $effect(() => {
    loadTimeline(DEMO_URI).then(result => {
      if (result.ok) demoTimeline = result.timeline;
      else demoError = result.error;
    });
  });

  let startSection = $state<HTMLElement | null>(null);

  /** Drives the arrival flash. The page is short enough that the scroll alone
      doesn't always make it obvious you went anywhere. */
  let justLanded = $state(false);
  let landedTimer: ReturnType<typeof setTimeout> | undefined;

  /** The hero button's only job: put the start section in front of you, and
      give it focus so a keyboard lands there too rather than back at the top. */
  function scrollToStart() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    startSection?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    startSection?.focus({ preventScroll: true });
    if (reduceMotion) return;

    // Flash once the scrolling stops, not while it's still moving, or the
    // whole thing is over before you've arrived. `scrollend` is the real
    // signal; the timeout covers browsers that don't fire it.
    clearTimeout(landedTimer);
    justLanded = false;
    const flash = () => {
      clearTimeout(landedTimer);
      justLanded = true;
      landedTimer = setTimeout(() => (justLanded = false), 1200);
    };
    if ('onscrollend' in window) {
      const scroller = startSection?.closest('.home-main');
      scroller?.addEventListener('scrollend', flash, { once: true });
      // A scroll that never happens (already in view) fires no scrollend.
      landedTimer = setTimeout(() => {
        scroller?.removeEventListener('scrollend', flash);
        flash();
      }, 700);
    } else {
      landedTimer = setTimeout(flash, 450);
    }
  }

  interface Props {
    /** Drafts held in this browser, most recently edited first. */
    drafts: DraftSummary[];
    /** Set when the browser will not store drafts locally. */
    persistWarning: string | null;
    /** Opening the editor is async and can fail; the row reports it rather than going dead. */
    onopendraft: (id: string) => void | Promise<void>;
    /** The row's own position, so the undo card can take its place. */
    ondeletedraft: (id: string, index: number) => void;
    /**
     * A draft just deleted, with the position its row had. Undo is on offer
     * while this is set; `deletedDraftsLeaving` fades the card out in place
     * rather than letting the list jump as it goes.
     */
    deletedDrafts?: { entries: DraftSummary[]; index: number } | null;
    deletedDraftsLeaving?: boolean;
    onundodeletedraft?: () => void;
    /** Drop a local copy with no undo — used when its record has just gone with it. */
    onforgetdraft: (id: string) => void;
    onnew: () => void;
    onimport: (tl: TLTimeline) => void;
    /** `replaceDraftId` drops that local draft first, so "start from published" really does. */
    onopen: (
      uri: string,
      result: { title?: string; cid?: string; timeline: TLTimeline },
      opts?: { replaceDraftId?: string },
    ) => void | Promise<void>;
    onsignout: () => void;
  }

  let { drafts, persistWarning, onopendraft, ondeletedraft,
    deletedDrafts = null, deletedDraftsLeaving = false, onundodeletedraft, onforgetdraft, onnew, onimport, onopen, onsignout }: Props = $props();

  const auth = $derived(getAuthState());

  // ── File import ──────────────────────────────────────────────────────────────

  let fileInput: HTMLInputElement;
  let fileError = $state<string | null>(null);

  function handleFile(e: Event) {
    fileError = null;
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        onimport(file.name.toLowerCase().endsWith('.csv') ? fromTL3CSV(text) : fromTL3(JSON.parse(text)));
      } catch {
        fileError = 'Could not parse file — check that it is a valid JSON or CSV timeline.';
      }
      fileInput.value = '';
    };
    reader.readAsText(file);
  }

  // ── URL import ───────────────────────────────────────────────────────────────

  let urlInput = $state('');
  let urlLoading = $state(false);
  let urlError = $state<string | null>(null);
  let corsDownloadUrl = $state<string | null>(null);
  let showUrlForm = $state(false);

  async function handleUrlImport(e: Event) {
    e.preventDefault();
    urlLoading = true;
    urlError = null;
    corsDownloadUrl = null;
    embedLinks = null;

    const rawUrl = urlInput.trim();
    const fetchUrl = normalizeTimelineSourceUrl(rawUrl);
    const isSheets = fetchUrl !== rawUrl;

    try {
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const text = await resp.text();
      onimport(parseTimelineText(text));
    } catch (err) {
      if (err instanceof TypeError) {
        corsDownloadUrl = fetchUrl;
        urlError = isSheets
          ? 'Google Sheets cannot be loaded directly due to browser security restrictions (CORS).'
          : 'This URL cannot be loaded directly due to browser security restrictions (CORS).';
      } else {
        urlError = String(err).replace(/^Error:\s*/, '');
      }
    } finally {
      urlLoading = false;
    }
  }

  // ── URL → embed/share (no import needed) ────────────────────────────────────
  // Mirrors the Publish drawer in EditorView.svelte: the embed page and share
  // worker already resolve a plain http(s) URL at view time (see
  // packages/embed/src/App.svelte and packages/player/src/lib/loader.ts), so a
  // pasted source URL can become a share/embed link directly — no fetch, parse,
  // or PDS write required on this end.

  const _embedMeta = document.querySelector('meta[name="tl-embed-base"]')?.getAttribute('content');
  const EMBED_BASE = (_embedMeta && !_embedMeta.startsWith('__')) ? _embedMeta : 'http://127.0.0.1:5200/';
  const _shareMeta = document.querySelector('meta[name="tl-share-base"]')?.getAttribute('content');
  const SHARE_BASE = (_shareMeta && !_shareMeta.startsWith('__')) ? _shareMeta : 'http://localhost:8787/ng/share';

  let embedLinks = $state<{ embedUrl: string; shareUrl: string; iframeCode: string } | null>(null);
  let copiedEmbed = $state<'iframe' | 'link' | null>(null);

  function handleGetEmbed(e: Event) {
    e.preventDefault();
    urlError = null;
    corsDownloadUrl = null;

    const rawUrl = urlInput.trim();
    try {
      new URL(rawUrl);
    } catch {
      urlError = 'Enter a valid URL first.';
      embedLinks = null;
      return;
    }

    const p = new URLSearchParams({ src: rawUrl });
    const embedUrl = `${EMBED_BASE}?${p}`;
    embedLinks = {
      embedUrl,
      shareUrl: `${SHARE_BASE}?${p}`,
      iframeCode: `<iframe src="${embedUrl}" width="100%" height="650" frameborder="0" allowfullscreen></iframe>`,
    };
  }

  function copyEmbed(text: string, which: 'iframe' | 'link') {
    void navigator.clipboard.writeText(text).then(() => {
      copiedEmbed = which;
      setTimeout(() => { copiedEmbed = null; }, 2000);
    });
  }

  // ── Timeline list ────────────────────────────────────────────────────────────

  // `listTimelines` has carried each record's CID since [P8]; the merged list
  // is what finally reads it, to notice another browser publishing without
  // opening anything.
  let publishedTimelines = $state<TimelineRecord[]>([]);
  let listLoading = $state(false);
  let openingUri = $state<string | null>(null);
  let confirmDeleteUri = $state<string | null>(null);
  let deletingUri = $state<string | null>(null);
  let demoDeleteConfirmText = $state('');

  function isDemoTimeline(uri: string): boolean {
    return uri === DEMO_URI;
  }

  function startDelete(uri: string) {
    confirmDeleteUri = uri;
    demoDeleteConfirmText = '';
  }

  function cancelDelete() {
    confirmDeleteUri = null;
    demoDeleteConfirmText = '';
  }

  $effect(() => {
    if (auth.status === 'signed-in') {
      void fetchList();
    } else {
      publishedTimelines = [];
    }
  });

  async function fetchList() {
    listLoading = true;
    try {
      publishedTimelines = await listTimelines();
    } finally {
      listLoading = false;
    }
  }

  /**
   * Why a row reports its own failures.
   *
   * Opening something is several awaits deep — fetch the record, attach a draft
   * store, fill a document — and a failure anywhere along it used to leave the
   * home screen exactly as it was. `getTimeline` returns `null` for every
   * problem it meets, and anything thrown further in became an unhandled
   * rejection, so either way the click did nothing and said nothing. That is
   * how a crash writing a record's blob reference into the document presented
   * itself: a dead button in this list.
   */
  let openError = $state<string | null>(null);

  const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  /**
   * Whether the timeline an unmerged draft came from is still in this
   * browser. When it is not, the draft has nowhere to be merged into, so it
   * must not be described by its position in a list it is no longer under.
   */
  function hasParent(draft: DraftSummary): boolean {
    return !!draft.forkedFrom && drafts.some((d) => d.atUri === draft.forkedFrom?.atUri && !d.forkedFrom);
  }

  /**
   * One row per timeline ([P5]). Local drafts draw immediately; records fold
   * in by `atUri` when `listTimelines` returns, which is why this is derived
   * rather than assembled once.
   */
  const rows = $derived(timelineRows(
    drafts,
    publishedTimelines,
    // Only a completed fetch of a signed-in account can say a record is not
    // there any more.
    auth.status === 'signed-in' && !listLoading,
    auth.status === 'signed-in' ? auth.session.sub : null,
  ));
  /** Unmerged drafts whose timeline is not in this browser, listed on their own. */
  const strayForks = $derived(orphanForks(drafts));

  /**
   * Fetch a record and open it. Only reached for a row with no local copy —
   * `openRow` sends every other row straight to the draft it already has, so
   * the "you have unpublished edits, continue or discard?" question this
   * used to ask is gone with the list that made it necessary.
   */
  async function handleOpen(uri: string) {
    openError = null;
    openingUri = uri;
    try {
      const result = await getTimeline(uri);
      if (!result) {
        openError = 'Could not load that timeline from your account. It may have been deleted, or stored in a format this editor does not recognise.';
        return;
      }
      // Still checked, because a row drawn before the fetch returned may have
      // gained a draft since — and two drafts claiming one record is the bug
      // `536221b` fixed ([P4]).
      const draft = drafts.find((d) => d.atUri === uri);
      if (draft) {
        await onopendraft(draft.id);
        return;
      }
      await onopen(uri, result);
    } catch (cause) {
      openError = `Could not open that timeline: ${reason(cause)}`;
      console.error('Opening timeline failed', uri, cause);
    } finally {
      // In a `finally` so a failure re-enables the list. Left set, it disabled
      // every row in the section, turning one bad record into a dead screen.
      openingUri = null;
    }
  }

  async function handleOpenDraft(id: string) {
    openError = null;
    try {
      await onopendraft(id);
    } catch (cause) {
      openError = `Could not open that draft: ${reason(cause)}`;
      console.error('Opening draft failed', id, cause);
    }
  }

  /**
   * Open the timeline this row stands for.
   *
   * The local copy when there is one — it is the same timeline, with whatever
   * was typed here since, and `checkPublished` compares it against the record
   * once the editor is up. Otherwise fetch the record and mint a draft.
   *
   * There is no longer a question to ask on the way in. It existed because
   * the account list offered a second way to open something this browser
   * already had, and one row has only one way.
   */
  async function openRow(row: TimelineRow) {
    if (row.draft) {
      await handleOpenDraft(row.draft.id);
      return;
    }
    if (row.record) await handleOpen(row.record.uri);
  }

  /**
   * Delete the timeline: the record, and the local copy with it.
   *
   * One object, one deletion. Leaving the local copy behind would put the row
   * straight back, now reading "no longer in your account" — which is a
   * truthful description of a state nobody asked for.
   */
  async function deleteWholeTimeline(row: TimelineRow) {
    const uri = row.record?.uri;
    if (!uri) return;
    deletingUri = uri;
    confirmDeleteUri = null;
    const result = await deleteTimeline(uri);
    deletingUri = null;
    if (!result.ok) return;
    publishedTimelines = publishedTimelines.filter(t => t.uri !== uri);
    // No undo card here: the record is gone for everyone, and offering to
    // put back only the local half would be offering the wrong thing.
    if (row.draft) onforgetdraft(row.draft.id);
  }

  function formatDate(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ];

  function formatRelativeTime(iso: string): string {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffSec = Math.round((then - Date.now()) / 1000);
    if (Math.abs(diffSec) < 60) return 'just now';
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const [unit, secondsInUnit] of RELATIVE_UNITS) {
      if (Math.abs(diffSec) >= secondsInUnit) {
        return rtf.format(Math.round(diffSec / secondsInUnit), unit);
      }
    }
    return formatDate(iso);
  }

  const draftName = (d: DraftSummary): string => d.title?.trim() || 'Untitled draft';
</script>

<div class="home-shell">

  <!-- ── Navbar ─────────────────────────────────────────────────────────────── -->
  <AppNavbar hidetitle />

  <!--
    Deleting a draft asks nothing and happens at once, with the card below
    offering it back for a few seconds. A confirmation asks someone to
    predict what they are about to lose; the card shows them. Only the
    published timeline, which no undo of ours can restore for the people
    holding its links, still asks first.
  -->
  <!--
    One shape for every row: a verb, a relative time, and a state when there
    is one more thing to say. Built from different materials — a relative
    phrase here, an absolute date there — two rows for two timelines read as
    two different kinds of object, when the only real difference is whether
    this browser has a copy.

    `createdAt` is rewritten on every publish, so for a record it means *last
    published* and compares honestly with a draft's `editedAt`.
  -->
  {#snippet stateLine(row: TimelineRow)}
    <span class="draft-row-meta">
      {#if row.draft}edited{:else}published{/if}
      {formatRelativeTime(row.editedAt)}
      {#if row.otherAccount}
        <!-- Listed, not hidden: a browser can hold work for more than one
             identity, and dropping those rows would read as the app having
             lost a timeline. What it cannot do is say anything about where
             that record stands, because this account's list is not about it. -->
        · <span class="draft-row-other">{row.otherAccount.handle ?? 'another account'}</span>
      {:else if row.state === 'unpublished'}
        · never published
      {:else if row.state === 'gone'}
        · <span class="draft-row-unpublished">no longer in your account</span>
      {:else if row.state === 'behind'}
        <!-- What the merged list buys: `listRecords` returns each record's
             CID and every draft remembers the one it was in step with, so
             this needs no extra request and no opening of the draft. -->
        · <span class="draft-row-unpublished">a newer version was published elsewhere</span>
      {:else if row.state === 'changed'}
        · <span class="draft-row-unpublished">unpublished changes</span>
      {:else if row.draft}
        · <span class="draft-row-published">published</span>
      {/if}
    </span>
  {/snippet}

  <!--
    One ✕, one meaning: delete this timeline. What follows differs because
    the timelines differ — one that was never published costs local work and
    nothing else, so it goes at once with an undo card; one that is public
    takes its record with it, which no undo of ours can give back to the
    people holding its links, so it asks first.
  -->
  {#snippet timelineRow(row: TimelineRow, index: number)}
    {#if confirmDeleteUri && row.record && confirmDeleteUri === row.record.uri}
      {#if isDemoTimeline(row.record.uri)}
        <div class="timeline-item-confirm timeline-item-confirm-demo">
          <span class="confirm-label confirm-label-demo">
            ⚠️ This is the public example timeline linked from the homepage ("Clone our example
            timeline"). Deleting it will break that link for every visitor. Type DELETE to confirm.
          </span>
          <input
            class="confirm-demo-input"
            type="text"
            placeholder="DELETE"
            bind:value={demoDeleteConfirmText}
            disabled={deletingUri === row.record.uri}
          />
          <button class="btn-confirm-delete"
            onclick={() => deleteWholeTimeline(row)}
            disabled={deletingUri === row.record.uri || demoDeleteConfirmText !== 'DELETE'}>
            {deletingUri === row.record.uri ? 'Deleting…' : 'Delete'}
          </button>
          <button class="btn-cancel-delete" onclick={cancelDelete} disabled={deletingUri === row.record.uri}>
            Cancel
          </button>
        </div>
      {:else}
        <div class="timeline-item-confirm">
          <span class="confirm-label">
            Delete "{row.title}"? It stops being published — every embed and share link stops
            working, for everyone, and this cannot be undone.{#if row.draft} Your copy in this
            browser goes too{#if row.state === 'changed' || row.state === 'behind'}, including
            changes you have not published{/if}.{/if}
          </span>
          <button class="btn-confirm-delete"
            onclick={() => deleteWholeTimeline(row)}
            disabled={deletingUri === row.record.uri}>
            {deletingUri === row.record.uri ? 'Deleting…' : 'Delete'}
          </button>
          <button class="btn-cancel-delete" onclick={cancelDelete}>Cancel</button>
        </div>
      {/if}
    {:else}
      <button
        class="draft-row-open"
        onclick={() => openRow(row)}
        disabled={!!openingUri || !!deletingUri}
      >
        <span class="draft-row-title">{row.title}</span>
        {@render stateLine(row)}
      </button>
      <button
        class="btn-delete-timeline"
        aria-label={`Delete ${row.title}`}
        disabled={!!openingUri || !!deletingUri}
        onclick={() => (row.published && row.record
          ? startDelete(row.record.uri)
          : row.draft && ondeletedraft(row.draft.id, index))}
      >✕</button>
    {/if}
  {/snippet}

  {#snippet forkRow(fork: DraftSummary, index: number)}
    <button class="draft-row-open" onclick={() => handleOpenDraft(fork.id)}>
      <span class="draft-row-title">{draftName(fork)}</span>
      <span class="draft-row-meta">
        edited {formatRelativeTime(fork.editedAt)} ·
        <!-- "never published" would read as something still to do. An
             unmerged draft cannot be published at all; it ends by being
             merged into the timeline above it, or deleted. -->
        <span class="draft-row-unpublished">
          {hasParent(fork) ? 'not merged yet' : 'the timeline it came from is gone'}
        </span>
      </span>
    </button>
    <button
      class="btn-delete-timeline"
      aria-label={`Delete ${draftName(fork)}`}
      onclick={() => ondeletedraft(fork.id, index)}
    >✕</button>
  {/snippet}

  {#snippet undoCard(pending: { entries: DraftSummary[]; index: number })}
    <li class="draft-item draft-item--deleted" class:draft-item--leaving={deletedDraftsLeaving}>
      <button class="draft-undo" onclick={onundodeletedraft}>
        <span class="draft-undo__text">
          <span class="draft-undo__name">Deleted “{draftName(pending.entries[0])}”</span>
          <span class="draft-undo__meta">
            {pending.entries.length > 1
              ? `Its ${pending.entries.length - 1 === 1 ? 'unmerged draft went' : `${pending.entries.length - 1} unmerged drafts went`} too.`
              : 'Nothing was published, so nothing was taken off the web.'}
          </span>
        </span>
        <span class="draft-undo__action">Undo</span>
      </button>
    </li>
  {/snippet}

  <!--
    [A4] An unmerged draft is shown attached to the timeline it came from,
    indented beneath it, rather than as its own row. A free-floating copy
    gets deleted or published by accident; attached, it reads as what it is —
    an open task belonging to that timeline.
  -->
  {#snippet rowList()}
    <ul class="draft-list">
      {#each rows as row, i (row.key)}
        {#if deletedDrafts && deletedDrafts.index === i}
          {@render undoCard(deletedDrafts)}
        {/if}
        <li class="draft-item">
          <div class="draft-row">{@render timelineRow(row, i)}</div>
          {#if row.forks.length}
            <ul class="fork-list">
              {#each row.forks as fork (fork.id)}
                <li class="draft-item">
                  <span class="fork-label">Unmerged draft</span>
                  <div class="draft-row">{@render forkRow(fork, i)}</div>
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/each}
      {#if deletedDrafts && deletedDrafts.index >= rows.length}
        <!-- The row was the last one; there is nothing left to sit above. -->
        {@render undoCard(deletedDrafts)}
      {/if}
      {#each strayForks as fork, i (fork.id)}
        <li class="draft-item">
          <span class="fork-label">Unmerged draft</span>
          <div class="draft-row">{@render forkRow(fork, rows.length + i)}</div>
        </li>
      {/each}
    </ul>
  {/snippet}

  <!-- ── Main ──────────────────────────────────────────────────────────────── -->
  <main class="home-main">

    <!-- ── Top band: the pitch, the demo, and the one button that starts it ── -->
    <div class="home-top">
      <div class="home-header">
        <h1 class="home-title">TimelineJS Reimagined</h1>
        <h2 class="product-tagline">Even easier-to-make, beautiful timelines.</h2>
        <!-- Goes to the section rather than straight into a new timeline:
             there is more than one way to start, and the account lists have
             nowhere else to live. -->
        <button class="btn-hero" onclick={scrollToStart}>Make a timeline</button>
      </div>

      <!-- Demo timeline -->
      <section class="home-section demo-section">
        {#if demoTimeline}
          <div class="demo-player">
            <SlidePlayer timeline={demoTimeline} />
          </div>
        {:else if demoError}
          <p class="demo-error">Could not load demo: {demoError}</p>
        {:else}
          <div class="demo-loading" aria-label="Loading demo timeline…"></div>
        {/if}
      </section>

      <div class="home-intro">
        <p>TimelineJS has been Knight Lab's most popular project. More than 1 million timelines have been created by people around the world and collectively they've been viewed over 1 billion times.</p>
        <p>A lot has changed since 2012 when it was released. We thought we'd try a little experiment to see how it might be different today.</p>
      </div>
    </div>

    <div class="home-layout">

      <div class="home-content">

      <!-- Start section -->
      <section
        class="home-section start-section"
        class:just-landed={justLanded}
        id="start"
        bind:this={startSection}
        tabindex="-1"
      >
        <h2 class="section-heading">Make a timeline</h2>
        <div class="start-actions">
          <button class="btn-make" onclick={onnew}>New timeline</button>
          <button class="btn-import-file" onclick={() => fileInput.click()}>From file</button>
          <input
            bind:this={fileInput}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            style="display:none"
            onchange={handleFile}
          />
          <button class="btn-paste-url" onclick={() => { showUrlForm = !showUrlForm; }}>From URL</button>
        </div>
        {#if showUrlForm}
          <form class="url-form" onsubmit={handleUrlImport}>
            <input
              class="url-input"
              type="url"
              placeholder="Paste a URL (JSON, CSV, or Google Sheets pubhtml link)"
              bind:value={urlInput}
              oninput={() => { embedLinks = null; }}
              disabled={urlLoading}
            />
            <button class="btn-url-import" type="submit" disabled={urlLoading || !urlInput.trim()}>
              {urlLoading ? 'Loading…' : 'Import to edit'}
            </button>
            <button class="btn-url-embed" type="button" onclick={handleGetEmbed} disabled={urlLoading || !urlInput.trim()}>
              Just get embed code
            </button>
          </form>
        {/if}
        {#if fileError}
          <p class="import-error" role="alert">{fileError}</p>
        {/if}
        {#if urlError}
          <p class="import-error" role="alert">
            {urlError}
            {#if corsDownloadUrl}
              <a href={corsDownloadUrl} target="_blank" rel="noopener noreferrer" class="download-link">
                Download the CSV
              </a>
              and import it as a file instead.
            {/if}
          </p>
        {/if}
        {#if embedLinks}
          <div class="embed-result">
            <p class="embed-result__intro">No import needed — paste this anywhere:</p>
            <div class="embed-code-row">
              <span class="embed-code-label">Embed</span>
              <code class="embed-code">{embedLinks.iframeCode}</code>
              <button class="btn-copy-embed" onclick={() => copyEmbed(embedLinks!.iframeCode, 'iframe')}>
                {copiedEmbed === 'iframe' ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div class="embed-code-row">
              <span class="embed-code-label">Direct link</span>
              <code class="embed-code">{embedLinks.shareUrl}</code>
              <button class="btn-copy-embed" onclick={() => copyEmbed(embedLinks!.shareUrl, 'link')}>
                {copiedEmbed === 'link' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        {/if}
        <p class="clone-hint">You can upload TimelineJS3 CSV or JSON configurations or provide a URL to a Google Sheets configuration, JSON, or CSV file.</p>
        <p class="clone-hint">
          Want to try out the editor but you don't have a story?
          {#if demoTimeline}
            <button type="button" class="clone-link" onclick={() => onimport(demoTimeline!)}>Clone our example timeline.</button>
          {:else}
            Clone our example timeline.
          {/if}
        </p>
      </section>

      <!-- Saved timelines -->
      <section class="home-section">
        <div class="section-header-row">
          <h2 class="section-heading">Your timelines</h2>
          <!-- Signed in this is an account chip, and signing in it is a status,
               so both belong up here beside the heading. Signed out it is an
               offer, and an offer belongs with the sentence making it — see
               the empty state below. -->
          {#if auth.status === 'signed-in' || auth.status === 'loading'}
            <AuthButton {onsignout} restoreView="home" />
          {/if}
        </div>
        <!-- Both kinds of row live in this section, so one alert covers them. -->
        {#if openError}
          <p class="open-error" role="alert">{openError}</p>
        {/if}
        {#if persistWarning}
          <p class="draft-warning" role="status">
            This browser isn’t storing drafts, so anything you write here will be
            gone when you close the tab. Save to your account to keep it.
          </p>
        {/if}
        <!-- `deletedDrafts` keeps the section alive while the undo card is
             up: deleting the only timeline would otherwise take the list and
             the card itself off the screen together. -->
        {#if rows.length || strayForks.length || deletedDrafts}
          <!-- Once per list, qualified, rather than repeated on every row it
               applies to: it is a fact about a category of timeline, and as a
               per-row tag it was both noise and part of what made two rows
               read as two different kinds of thing. -->
          {#if rows.some((r) => !r.published)}
            <p class="draft-list-note">Timelines you haven’t published are kept in this browser only.</p>
          {/if}
          {@render rowList()}
        {:else if listLoading}
          <p class="list-loading">Loading…</p>
        {:else if auth.status === 'signed-in'}
          <p class="list-empty">Nothing yet. Make one above.</p>
        {/if}

        {#if auth.status === 'loading'}
          <p class="list-empty">Signing you in…</p>
        {:else if auth.status !== 'signed-in'}
          <div class="signed-out-offer">
            <p class="list-empty">Sign in to publish your timelines and pick them up again here.</p>
            <AuthButton {onsignout} restoreView="home" />
          </div>
        {/if}
      </section>

      </div>

      <aside class="home-sidebar">
        <nav class="sidebar-docs" aria-label="Documentation">
        <h2>Documentation</h2>
          <a href="./docs.html#intro" target="_blank" rel="noopener noreferrer">Getting Started</a>
          <a href="./docs.html#atmosphere" target="_blank" rel="noopener noreferrer">About Atmosphere</a>
          <a href="./docs.html#media-types" target="_blank" rel="noopener noreferrer">Media types</a>
          <a href="./docs.html#appearance" target="_blank" rel="noopener noreferrer">Appearance</a>
          <a href="./docs.html#custom-properties" target="_blank" rel="noopener noreferrer">CSS Custom properties</a>
          <a href="./docs.html#self-hosting" target="_blank" rel="noopener noreferrer">Self-hosting</a>
          <a href="./docs.html#data-format" target="_blank" rel="noopener noreferrer">Data format</a>
        </nav>
      </aside>

    </div>
  </main>
</div>

<style>
  .home-shell {
    display: grid;
    grid-template-rows: auto auto 1fr;
    height: 100vh;
    font-family: 'Apres RE', system-ui, sans-serif;
    background: #f8f8f8;
  }

  /* ── Draft bar ───────────────────────────────────────────────── */




  /* ── Demo timeline ───────────────────────────────────────────── */
  .demo-section { gap: 0; }

  .demo-player {
    height: 500px;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    overflow: hidden;
  }

  .demo-loading {
    height: 500px;
    background: #f3f4f6;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .demo-error {
    font-size: 0.8rem;
    color: #9ca3af;
    margin: 0;
  }

  /* ── Main content ────────────────────────────────────────────── */
  .home-main { overflow-y: auto; }

  /* Two stacked bands share one measure: the pitch and the demo run the full
     width, and the two-column split only starts at "Make a timeline". */
  .home-top,
  .home-layout {
    max-width: 1100px;
    margin: 0 auto;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }

  .home-top {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding-top: 1.75rem;
    padding-bottom: 2rem;
  }

  .home-layout {
    display: flex;
    gap: 0;
    padding-bottom: 2.5rem;
    align-items: flex-start;
  }

  .home-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.5rem;
  }

  /* The demo is the pitch, so the one green button above it points at the
     section that starts a timeline rather than competing with the demo. */
  .btn-hero {
    background: #57a141;
    border: 1px solid #57a141;
    color: #fff;
    margin: 0.5rem 0 0;
    padding: 0.6rem 1.75rem;
    font-size: 0.95rem;
    font-family: inherit;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    text-shadow: none;
    box-shadow: none;
    cursor: pointer;
    border-radius: 4px;
  }
  .btn-hero:hover { background: #4a8c37; border-color: #4a8c37; }

  /* Was the top of the right rail; at full width it reads better as two
     columns of prose under the demo than as one very long line. */
  .home-intro {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.5rem;
    font-size: 0.9rem;
    color: #6b7280;
    line-height: 1.6;
  }

  .home-intro p { margin: 0; }

  .home-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .product-tagline {
    font-size: 1rem;
    font-weight: 400;
    color: #df4e13;
    margin: 0;
  }

  .home-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding-right: 2.5rem;
  }

  .home-sidebar {
    width: 300px;
    flex-shrink: 0;
    padding: 0 0 0 2rem;
    border-left: 1px solid #e8e8e8;
    font-size: 0.875rem;
    color: #6b7280;
    line-height: 1.6;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .sidebar-docs {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .sidebar-docs h2 {
    font-size: 0.7rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0;
  }

  .sidebar-docs a {
    color: #df4e13;
    text-decoration: none;
    text-shadow: none;
    font-size: 0.85rem;
  }
  .sidebar-docs a:hover { color: #b93e0d; text-decoration: underline; }

  .home-section { display: flex; flex-direction: column; gap: 1rem; }
  /* Focused only because the hero button sent you here. */
  .home-section:focus { outline: none; }
  .home-section:focus-visible { outline: none; }

  /* The landing. The wash bleeds past the content so it reads as "this part of
     the page", and the padding is there whether or not it ever flashes. */
  .start-section {
    padding: 0.75rem;
    margin: -0.75rem;
    border-radius: 4px;
    scroll-margin-top: 0.75rem;
  }

  .start-section.just-landed {
    animation: land 1.2s ease-out;
  }

  @keyframes land {
    0%   { background: rgba(223, 78, 19, 0.14); }
    60%  { background: rgba(223, 78, 19, 0.1); }
    100% { background: rgba(223, 78, 19, 0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .start-section.just-landed { animation: none; }
  }

  .section-heading {
    font-size: 0.7rem;
    font-weight: 600;
    color: #888;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #e8e8e8;
  }

  /* ── Start ───────────────────────────────────────────────────── */
  .start-actions { display: flex; align-items: stretch; gap: 0.75rem; flex-wrap: wrap; }

  .btn-make {
    background: #57a141;
    border: 1px solid #57a141;
    color: #fff;
    padding: 0.5rem 1.25rem;
    font-size: 0.875rem;
    font-family: inherit;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    border-radius: 4px;
  }
  .btn-make:hover { background: #4a8c37; border-color: #4a8c37; }

  /* ── Import ──────────────────────────────────────────────────── */
  .btn-import-file, .btn-paste-url {
    background: transparent;
    border: 1px solid #d1d5db;
    color: #374151;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
  }
  .btn-import-file:hover, .btn-paste-url:hover { border-color: #9ca3af; background: #f9fafb; }

  .url-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }

  .url-input {
    flex: 1;
    border: 1px solid #d1d5db;
    border-radius: 2px;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
    font-family: inherit;
    color: #111;
    background: #fff;
  }
  .url-input:focus { outline: none; border-color: #df4e13; }
  .url-input::placeholder { color: #9ca3af; }

  .btn-url-import {
    background: transparent;
    border: 1px solid #df4e13;
    color: #df4e13;
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
  }
  .btn-url-import:hover:not(:disabled) { background: #df4e13; color: #fff; }
  .btn-url-import:disabled { opacity: 0.5; cursor: default; }

  .btn-url-embed {
    background: transparent;
    border: 1px solid #d1d5db;
    color: #374151;
    padding: 0.4rem 0.75rem;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
  }
  .btn-url-embed:hover:not(:disabled) { border-color: #9ca3af; background: #f9fafb; }
  .btn-url-embed:disabled { opacity: 0.5; cursor: default; }

  .embed-result {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    background: #fafafa;
  }

  .embed-result__intro {
    font-size: 0.8rem;
    color: #6b7280;
    margin: 0;
  }

  .embed-code-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .embed-code-label {
    font-size: 0.75rem;
    color: #9ca3af;
    width: 4.5rem;
    flex-shrink: 0;
  }

  .embed-code {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 0.75rem;
    color: #111;
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 2px;
    padding: 0.3rem 0.5rem;
    overflow-x: auto;
    white-space: nowrap;
  }

  .btn-copy-embed {
    background: transparent;
    border: 1px solid #df4e13;
    color: #df4e13;
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-copy-embed:hover { background: #df4e13; color: #fff; }

  .import-error {
    font-size: 0.8rem;
    color: #b91c1c;
    margin: 0;
    line-height: 1.4;
  }

  .download-link { color: #2563eb; }

  .open-error {
    margin: 0;
    padding: 0.5rem 0.7rem;
    border-left: 3px solid #b91c1c;
    background: #fef2f2;
    font-size: 0.8rem;
    line-height: 1.45;
    color: #7f1d1d;
  }

  /* ── Timeline list ───────────────────────────────────────────── */
  /* The reason and the button, in that order and close enough to read as one
     offer. They used to sit at opposite ends of the column. */
  .signed-out-offer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .list-loading, .list-empty {
    font-size: 0.85rem;
    color: #9ca3af;
    margin: 0;
  }





  /*
   * Orangeline gives every <button> a bottom margin, a three-layer shadow and
   * a radius, so this one rendered as a raised chip: 31px tall in a 47px row,
   * lifted off the surface and pushed past the card's own edge. The resets are
   * the whole fix — it is meant to be the right-hand end of the row, not an
   * object sitting on top of it.
   */
  .btn-delete-timeline {
    background: transparent;
    border: none;
    border-left: 1px solid #e8e8e8;
    border-radius: 0;
    margin: 0;
    box-shadow: none;
    text-shadow: none;
    color: #d1d5db;
    padding: 0 0.75rem;
    font-size: 0.75rem;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn-delete-timeline:hover:not(:disabled) { color: #ef4444; background: #fef2f2; }
  .btn-delete-timeline:disabled { opacity: 0.4; cursor: default; }

  /* Wraps rather than pushing its buttons out of the row. A draft's
     confirmation is a sentence or two — it names what else goes with it —
     and on one nowrap line that drove Delete and Cancel past the card's
     edge, where the card's own overflow clipped them. */
  .timeline-item-confirm {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    flex: 1;
    min-width: 0;
    background: #fef2f2;
  }




  .confirm-label {
    font-size: 0.85rem;
    line-height: 1.35;
    color: #b91c1c;
    flex: 1 1 14rem;
    min-width: 0;
  }

  /* The same resets: these replace the ✕ in the row when it is clicked, so
     they cannot be raised chips either. */
  .btn-confirm-delete {
    background: #ef4444;
    border: 1px solid #ef4444;
    color: #fff;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    margin: 0;
    box-shadow: none;
    text-shadow: none;
    text-transform: none;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-confirm-delete:hover:not(:disabled) { background: #dc2626; }
  .btn-confirm-delete:disabled { opacity: 0.6; cursor: wait; }

  .btn-cancel-delete {
    background: transparent;
    border: 1px solid #d1d5db;
    color: #6b7280;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    margin: 0;
    box-shadow: none;
    text-shadow: none;
    text-transform: none;
    flex-shrink: 0;
  }
  .btn-cancel-delete:hover { border-color: #9ca3af; color: #374151; }
  .btn-cancel-delete:disabled { opacity: 0.6; cursor: wait; }

  .timeline-item-confirm-demo {
    flex-wrap: wrap;
    align-items: center;
  }

  .confirm-label-demo {
    flex-basis: 100%;
    white-space: normal;
    overflow: visible;
    text-overflow: clip;
    margin-bottom: 0.4rem;
  }

  .confirm-demo-input {
    font-family: inherit;
    font-size: 0.78rem;
    padding: 0.2rem 0.4rem;
    border: 1px solid #d1d5db;
    border-radius: 2px;
    width: 6rem;
    flex-shrink: 0;
  }



  .clone-hint {
    font-size: 0.8rem;
    color: #9ca3af;
    margin: 0;
    line-height: 1.5;
  }
  /* Acts in place rather than navigating, so it is a button wearing a link's
     clothes. Orangeline styles every <button>, so the reset is explicit. */
  .clone-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    font: inherit;
    color: #2563eb;
    text-decoration: underline;
    text-transform: none;
    text-shadow: none;
    box-shadow: none;
    border-radius: 0;
    cursor: pointer;
  }
  .clone-link:hover { color: #1d4ed8; }

  /* ── Responsive ──────────────────────────────────────────────── */
  /* 820px covers iPad mini portrait (744-768px CSS width) while leaving
     landscape (1024px) as two-column. */
  @media (max-width: 820px) {
    .home-shell { height: 100dvh; }

    .home-top,
    .home-layout {
      padding-left: 1rem;
      padding-right: 1rem;
    }

    .home-top {
      padding-top: 1rem;
      padding-bottom: 1.5rem;
    }

    .home-intro {
      grid-template-columns: 1fr;
      gap: 1rem;
    }

    .home-layout {
      flex-direction: column;
      align-items: stretch;
      padding-bottom: 1.5rem;
      gap: 1.5rem;
    }

    .home-content {
      padding-right: 0;
    }

    .home-sidebar {
      width: auto;
      border-left: none;
      border-top: 1px solid #e8e8e8;
      padding: 1.5rem 0 0;
    }

    .demo-player,
    .demo-loading {
      height: 480px;
    }

    .start-actions {
      flex-wrap: nowrap;
    }

    .btn-make {
      flex: none;
    }

    .btn-import-file,
    .btn-paste-url {
      flex: 1;
    }
  }

  @media (max-width: 480px) {
    .demo-player,
    .demo-loading {
      height: 600px;
    }
  }

  /* Same container as the published list below it. Two lists of the same kind
     of thing, one on a bordered white card and the other loose on the page
     background, read as one list and one stray fragment — and the loose one
     reads as the unfinished half, which is the opposite of what a draft is. */
  /* One footnote for the list, not a tag on each row it applies to. */
  .draft-list-note {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .draft-list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: #fff;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    overflow: hidden;
  }
  .draft-item + .draft-item { border-top: 1px solid #e8e8e8; }
  .fork-list {
    list-style: none;
    margin: 0;
    padding: 0 0 0 1.5rem;
  }
  /* The nested draft keeps its own rule, which now reads as a rail inside the
     card rather than as the only border in the neighbourhood. */
  .fork-list > .draft-item {
    border-top: 1px solid #eef0f1;
    border-left: 2px solid #e2e5e8;
  }


  .fork-label {
    display: block;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #7a7f85;
    /* Aligned with the title it labels, which now starts a row's padding in. */
    padding: 0.5rem 1rem 0;
    background: #fff;
  }

  /*
   * The row is the flex line; the item around it is what a fork list hangs
   * from. Without the wrapper the nested list became a flex child and sat
   * beside the title instead of under it.
   */
  .draft-item {
    list-style: none;
  }

  .draft-row {
    display: flex;
    align-items: stretch;
    background: #fff;
  }
  .draft-row:hover { background: #f9fafb; }

  /* The deleted row's place, held for as long as undo is on offer. Same
     shape as the row it replaces so nothing below it moves, and the same
     in-and-out as the editor's restore row for a deleted slide. */
  .draft-item--deleted {
    background: #f3f4f6;
    animation: draftUndoIn 0.18s ease forwards;
  }

  .draft-item--leaving {
    animation: draftUndoOut 0.35s ease forwards;
  }

  @keyframes draftUndoIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes draftUndoOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .draft-item--deleted,
    .draft-item--leaving { animation: none; }
    .draft-item--leaving { opacity: 0; }
  }

  .draft-undo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    border-radius: 0;
    margin: 0;
    box-shadow: none;
    text-shadow: none;
    text-transform: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .draft-undo:hover { background: #e9ebee; }

  .draft-undo__text { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
  .draft-undo__name { font-weight: 600; color: #4b5563; }
  .draft-undo__meta { font-size: 0.75rem; color: #6b7280; }

  .draft-undo__action {
    flex-shrink: 0;
    font-size: 0.8rem;
    font-weight: 700;
    color: #df4e13;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .draft-row-open {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    /* The published rows' padding, so a title in one list starts where a
       title in the other does. */
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font: inherit;
    /* `font: inherit` does not cover these, and Orangeline sets all three on
       every <button> — which is what made these rows read as raised cards in
       small caps next to the flat account list. */
    text-transform: none;
    text-shadow: none;
    box-shadow: none;
    border-radius: 0;
    margin: 0;
  }
  .draft-row-open:hover .draft-row-title { text-decoration: underline; }
  .draft-row-title { font-weight: 600; color: #1d1f21; }
  .draft-row-meta { font-size: 0.75rem; color: #666; }
  /* A published draft is the same timeline as its row in the account list, not
     separate work — saying so is what stops the two lists reading as two
     unrelated things. */
  .draft-row-published { color: #15803d; }
  .draft-row-unpublished { color: #92400e; font-weight: 600; }
  /* Neither good news nor a warning: a fact about which account this one
     publishes to. */
  .draft-row-other { color: #4b5563; font-weight: 600; }
  .draft-warning {
    margin: 0.75rem 0;
    padding: 0.5rem 0.7rem;
    border-left: 3px solid #d97706;
    background: #fffbeb;
    font-size: 0.8rem;
    line-height: 1.45;
    color: #5b4508;
  }
</style>
