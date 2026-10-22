<script lang="ts">
  import { fromTL3, fromTL3CSV, normalizeTimelineSourceUrl, parseTimelineText } from '@knight-lab/timeline-ng-core';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';
  import type { DraftSummary } from '../lib/localStore.ts';
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

  interface Props {
    /** Drafts held in this browser, most recently edited first. */
    drafts: DraftSummary[];
    /** Set when the browser will not store drafts locally. */
    persistWarning: string | null;
    /** Opening the editor is async and can fail; the row reports it rather than going dead. */
    onopendraft: (id: string) => void | Promise<void>;
    ondeletedraft: (id: string) => void;
    onnew: () => void;
    onimport: (tl: TLTimeline) => void;
    /** `replaceDraftId` drops that local draft first, so "start from published" really does. */
    onopen: (
      uri: string,
      result: { title?: string; timeline: TLTimeline },
      opts?: { replaceDraftId?: string },
    ) => void | Promise<void>;
    onsignout: () => void;
  }

  let { drafts, persistWarning, onopendraft, ondeletedraft, onnew, onimport, onopen, onsignout }: Props = $props();

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

  type ListItem = { uri: string; title: string; createdAt: string };
  let publishedTimelines = $state<ListItem[]>([]);
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

  /** Which draft row is showing its delete confirmation, mirroring confirmDeleteUri. */
  let confirmDeleteDraftId = $state<string | null>(null);

  const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

  /**
   * An account row whose local draft has edits the published copy does not,
   * held until the reader says which one they meant. The fetched record is
   * kept with it so answering does not have to go back for it.
   */
  let pendingOpen = $state<{ uri: string; draftId: string; result: { title?: string; timeline: TLTimeline } } | null>(null);

  async function handleOpen(uri: string) {
    openError = null;
    pendingOpen = null;
    openingUri = uri;
    try {
      const result = await getTimeline(uri);
      if (!result) {
        openError = 'Could not load that timeline from your account. It may have been deleted, or stored in a format this editor does not recognise.';
        return;
      }

      // Opening an account row lands in that timeline's local draft when one
      // exists, which is right but invisible: the reader asked for the
      // published copy and silently got edits they may have forgotten, or may
      // have clicked precisely to get rid of. Ask — but only when the draft
      // actually holds something the published copy does not.
      //
      // The document's own clean flag, not a timestamp comparison: publishing
      // writes the new `atUri` and marks the document clean, and both are
      // edits, so a freshly published draft always looks newer than the record
      // it just produced. `!== true` rather than `=== false` so an entry
      // written before this was recorded is asked about rather than assumed
      // safe; it gains a real value the next time it is edited.
      const draft = drafts.find((d) => d.atUri === uri);
      if (draft && draft.clean !== true) {
        pendingOpen = { uri, draftId: draft.id, result };
        return;
      }
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

  /** Answer the unpublished-edits question: keep the draft, or drop it for the published copy. */
  async function resolvePendingOpen(keepDraft: boolean) {
    const pending = pendingOpen;
    if (!pending) return;
    pendingOpen = null;
    try {
      if (keepDraft) await onopendraft(pending.draftId);
      else await onopen(pending.uri, pending.result, { replaceDraftId: pending.draftId });
    } catch (cause) {
      openError = `Could not open that timeline: ${reason(cause)}`;
      console.error('Opening timeline failed', pending.uri, cause);
    }
  }

  async function handleDelete(uri: string) {
    deletingUri = uri;
    confirmDeleteUri = null;
    const result = await deleteTimeline(uri);
    deletingUri = null;
    if (result.ok) {
      publishedTimelines = publishedTimelines.filter(t => t.uri !== uri);
    }
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

  {#snippet draftList()}
    <ul class="draft-list">
      {#each drafts as draft (draft.id)}
        <li class="draft-row">
          {#if confirmDeleteDraftId === draft.id}
            <!-- Same inline confirm as a timeline in the account list, rather
                 than a native window.confirm. -->
            <div class="timeline-item-confirm">
              <span class="confirm-label">
                Delete "{draftName(draft)}" from this browser?{draft.atUri ? ' Anything already published stays published.' : ''}
              </span>
              <button class="btn-confirm-delete" onclick={() => { confirmDeleteDraftId = null; ondeletedraft(draft.id); }}>
                Delete
              </button>
              <button class="btn-cancel-delete" onclick={() => (confirmDeleteDraftId = null)}>
                Cancel
              </button>
            </div>
          {:else}
          <button class="draft-row-open" onclick={() => handleOpenDraft(draft.id)}>
            <span class="draft-row-title">{draftName(draft)}</span>
            <span class="draft-row-meta">
              edited {formatRelativeTime(draft.editedAt)} ·
              {#if !draft.atUri}
                never published
              {:else if draft.clean === true}
                <span class="draft-row-published">published</span>
              {:else}
                <span class="draft-row-unpublished">unpublished changes</span>
              {/if}
            </span>
          </button>
          <button
            class="btn-delete-timeline"
            aria-label={`Delete ${draftName(draft)}`}
            onclick={() => (confirmDeleteDraftId = draft.id)}
          >✕</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/snippet}

  <!-- ── Main ──────────────────────────────────────────────────────────────── -->
  <main class="home-main">
    <div class="home-layout">

      <div class="home-content">
        <div class="home-header">
          <h1 class="home-title">TimelineJS Reimagined</h1>
          <h2 class="product-tagline">Even easier-to-make, beautiful timelines.</h2>
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

      <!-- Start section -->
      <section class="home-section">
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
          <AuthButton {onsignout} restoreView="home" />
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
        {#if drafts.length > 0}
          <h3 class="draft-list-heading">In this browser</h3>
          {@render draftList()}
        {/if}
        {#if auth.status === 'signed-in'}
          <!-- Paired with "In this browser" above: the two lists are the same
               kind of thing in two places, so both say which place. Without
               this the account list was simply unlabelled, and the drafts'
               heading read as if it covered everything below it. -->
          <h3 class="draft-list-heading">In your account</h3>
          {#if listLoading}
            <p class="list-loading">Loading…</p>
          {:else if publishedTimelines.length === 0}
            <p class="list-empty">Nothing published yet.</p>
          {:else}
            <ul class="timeline-list">
              {#each publishedTimelines as item (item.uri)}
                <li class="timeline-item">
                  {#if confirmDeleteUri === item.uri}
                    {#if isDemoTimeline(item.uri)}
                      <div class="timeline-item-confirm timeline-item-confirm-demo">
                        <span class="confirm-label confirm-label-demo">
                          ⚠️ This is the public example timeline linked from the homepage ("Clone our example timeline"). Deleting it will break that link for every visitor. Type DELETE to confirm.
                        </span>
                        <input
                          class="confirm-demo-input"
                          type="text"
                          placeholder="DELETE"
                          bind:value={demoDeleteConfirmText}
                          disabled={deletingUri === item.uri}
                        />
                        <button class="btn-confirm-delete"
                          onclick={() => handleDelete(item.uri)}
                          disabled={deletingUri === item.uri || demoDeleteConfirmText !== 'DELETE'}>
                          {deletingUri === item.uri ? 'Deleting…' : 'Delete'}
                        </button>
                        <button class="btn-cancel-delete" onclick={cancelDelete} disabled={deletingUri === item.uri}>
                          Cancel
                        </button>
                      </div>
                    {:else}
                      <div class="timeline-item-confirm">
                        <span class="confirm-label">Delete "{item.title}"?</span>
                        <button class="btn-confirm-delete"
                          onclick={() => handleDelete(item.uri)}
                          disabled={deletingUri === item.uri}>
                          {deletingUri === item.uri ? 'Deleting…' : 'Delete'}
                        </button>
                        <button class="btn-cancel-delete" onclick={cancelDelete}>
                          Cancel
                        </button>
                      </div>
                    {/if}
                  {:else if pendingOpen?.uri === item.uri}
                    <div class="timeline-item-choice">
                      <span class="choice-label">
                        You have edits to "{item.title}" in this browser that aren’t published yet.
                      </span>
                      <button class="btn-choice-primary" onclick={() => resolvePendingOpen(true)}>
                        Continue editing
                      </button>
                      <button class="btn-cancel-delete" onclick={() => resolvePendingOpen(false)}>
                        Discard them
                      </button>
                      <button class="btn-cancel-delete" onclick={() => (pendingOpen = null)}>
                        Cancel
                      </button>
                    </div>
                  {:else}
                    <button
                      class="timeline-item-btn"
                      onclick={() => handleOpen(item.uri)}
                      disabled={!!openingUri || !!deletingUri}
                    >
                      <span class="item-title">{item.title}</span>
                      {#if item.createdAt}
                        <span class="item-date">{formatDate(item.createdAt)}</span>
                      {/if}
                    </button>
                    <button
                      class="btn-delete-timeline"
                      onclick={() => startDelete(item.uri)}
                      disabled={!!openingUri || !!deletingUri}
                      aria-label="Delete {item.title}"
                    >✕</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          <p class="list-empty">Sign in to publish your timelines and pick them up again here.</p>
        {/if}
      </section>

      </div>

      <aside class="home-sidebar">
        <p>TimelineJS has been Knight Lab's most popular project. More than 1 million timelines have been created by people around the world and collectively they've been viewed over 1 billion times.</p>
        <p>A lot has changed since 2012 when it was released. We thought we'd try a little experiment to see how it might be different today.</p>
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
    height: 420px;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    overflow: hidden;
  }

  .demo-loading {
    height: 420px;
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

  .home-layout {
    display: flex;
    gap: 0;
    max-width: 1100px;
    margin: 0 auto;
    padding: 1.25rem 1.5rem 2.5rem;
    align-items: flex-start;
  }

  .home-header {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

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

  .home-sidebar p { margin: 0; }

  .sidebar-docs {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid #e8e8e8;
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
  .list-loading, .list-empty {
    font-size: 0.85rem;
    color: #9ca3af;
    margin: 0;
  }

  .timeline-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    overflow: hidden;
  }

  .timeline-item + .timeline-item { border-top: 1px solid #e8e8e8; }

  .timeline-item {
    display: flex;
    align-items: stretch;
  }

  .timeline-item-btn {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    flex: 1;
    background: #fff;
    border: none;
    padding: 0.75rem 1rem;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    min-width: 0;
  }
  .timeline-item-btn:hover { background: #f9fafb; }
  .timeline-item-btn:disabled { opacity: 0.6; cursor: default; }

  .btn-delete-timeline {
    background: transparent;
    border: none;
    border-left: 1px solid #e8e8e8;
    color: #d1d5db;
    padding: 0 0.75rem;
    font-size: 0.75rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .btn-delete-timeline:hover:not(:disabled) { color: #ef4444; background: #fef2f2; }
  .btn-delete-timeline:disabled { opacity: 0.4; cursor: default; }

  .timeline-item-confirm {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    flex: 1;
    background: #fef2f2;
  }

  /* A question, not a warning — same shape as the delete confirm, amber
     rather than red, since nothing is destroyed until "Discard them". */
  .timeline-item-choice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    flex: 1;
    flex-wrap: wrap;
    background: #fffbeb;
  }

  .choice-label {
    font-size: 0.85rem;
    color: #5b4508;
    flex: 1;
    min-width: 12rem;
  }

  .btn-choice-primary {
    background: #df4e13;
    border: 1px solid #df4e13;
    color: #fff;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
    margin: 0;
    text-transform: none;
    text-shadow: none;
    box-shadow: none;
  }
  .btn-choice-primary:hover { background: #c44310; border-color: #c44310; }

  .confirm-label {
    font-size: 0.85rem;
    color: #b91c1c;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-confirm-delete {
    background: #ef4444;
    border: 1px solid #ef4444;
    color: #fff;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
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

  .item-title { font-size: 0.9rem; color: #111; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .item-date { font-size: 0.75rem; color: #9ca3af; white-space: nowrap; flex-shrink: 0; }

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

    .home-layout {
      flex-direction: column;
      align-items: stretch;
      padding: 0.75rem 1rem 1.5rem;
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

  .draft-list-heading {
    margin: 1.25rem 0 0.4rem;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #666;
  }
  .draft-list { list-style: none; margin: 0; padding: 0; }
  .draft-row {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
    border-bottom: 1px solid #e6e6e6;
  }
  .draft-row:last-child { border-bottom: none; }
  .draft-row-open {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.55rem 0.2rem;
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
