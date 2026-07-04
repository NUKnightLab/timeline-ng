<script lang="ts">
  import { fromTL3, fromTL3CSV } from '@knight-lab/timeline-ng-core';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';
  import type { Draft } from '../lib/draft.ts';
  import { getAuthState, listTimelines, getTimeline, deleteTimeline } from '../lib/atproto.svelte.ts';
  import AppNavbar from './AppNavbar.svelte';
  import { SlidePlayer, loadTimeline } from '@knight-lab/timeline-ng';

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
    pendingDraft: Draft | null;
    onrestore: () => void;
    ondiscard: () => void;
    onnew: () => void;
    onimport: (tl: TLTimeline) => void;
    onopen: (uri: string, result: { title?: string; timeline: TLTimeline }) => void;
    onsignout: () => void;
  }

  let { pendingDraft, onrestore, ondiscard, onnew, onimport, onopen, onsignout }: Props = $props();

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

    let fetchUrl = urlInput.trim();
    let isSheets = false;

    const sheetsMatch = fetchUrl.match(/docs\.google\.com\/spreadsheets\/d\/e\/([^/]+)\/pubhtml/);
    if (sheetsMatch) {
      isSheets = true;
      fetchUrl = `https://docs.google.com/spreadsheets/d/e/${sheetsMatch[1]}/pub?output=csv`;
    }

    try {
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const text = await resp.text();
      const trimmed = text.trimStart();
      // CSV if it starts with a quote, or definitely not JSON object/array
      const tl = (trimmed.startsWith('"') || (!trimmed.startsWith('{') && !trimmed.startsWith('[')))
        ? fromTL3CSV(text)
        : fromTL3(JSON.parse(text));
      onimport(tl);
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

  // ── Timeline list ────────────────────────────────────────────────────────────

  type ListItem = { uri: string; title: string; createdAt: string };
  let savedTimelines = $state<ListItem[]>([]);
  let listLoading = $state(false);
  let openingUri = $state<string | null>(null);
  let confirmDeleteUri = $state<string | null>(null);
  let deletingUri = $state<string | null>(null);

  $effect(() => {
    if (auth.status === 'signed-in') {
      void fetchList();
    } else {
      savedTimelines = [];
    }
  });

  async function fetchList() {
    listLoading = true;
    try {
      savedTimelines = await listTimelines();
    } finally {
      listLoading = false;
    }
  }

  async function handleOpen(uri: string) {
    openingUri = uri;
    const result = await getTimeline(uri);
    openingUri = null;
    if (result) onopen(uri, result);
  }

  async function handleDelete(uri: string) {
    deletingUri = uri;
    confirmDeleteUri = null;
    const result = await deleteTimeline(uri);
    deletingUri = null;
    if (result.ok) {
      savedTimelines = savedTimelines.filter(t => t.uri !== uri);
    }
  }

  function formatDate(iso: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch { return ''; }
  }
</script>

<div class="home-shell">

  <!-- ── Navbar ─────────────────────────────────────────────────────────────── -->
  <AppNavbar hidetitle />

  {#snippet draftBar()}
    <div class="draft-bar">
      <span class="draft-bar-label">Unsaved draft</span>
      <button class="draft-bar-continue" onclick={onrestore}>Continue editing</button>
      <button class="draft-bar-discard" onclick={ondiscard}>Discard</button>
    </div>
  {/snippet}

  <!-- ── Draft bar ─────────────────────────────────────────────────────────── -->
  {#if pendingDraft && (pendingDraft.events.length > 0 || pendingDraft.titleEvent)}
    {@render draftBar()}
  {/if}

  <!-- ── Main ──────────────────────────────────────────────────────────────── -->
  <main class="home-main">
    <div class="home-layout">

      <div class="home-content">
        <h1 class="home-title">TimelineJS Reimagined</h1>

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
              disabled={urlLoading}
            />
            <button class="btn-url-import" type="submit" disabled={urlLoading || !urlInput.trim()}>
              {urlLoading ? 'Loading…' : 'Import'}
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
        <p class="clone-hint">You can upload TimelineJS3 CSV or JSON configurations or provide a URL to a Google Sheets configuration, JSON, or CSV file.</p>
        <p class="clone-hint">
          Want to try out the editor but you don't have a story?
          {#if demoTimeline}
            <a href="#" class="clone-link" onclick={(e) => { e.preventDefault(); onimport(demoTimeline!); }}>Clone our example timeline.</a>
          {:else}
            Clone our example timeline.
          {/if}
        </p>
      </section>

      <!-- Saved timelines -->
      {#if auth.status === 'signed-in'}
        <section class="home-section">
          <div class="section-header-row">
            <h2 class="section-heading">Your timelines</h2>
            <div class="account-status">
              {#if auth.avatar}
                <img class="account-avatar" src={auth.avatar} alt="" />
              {:else}
                <span class="account-avatar account-initials">{auth.handle[0]?.toUpperCase() ?? '?'}</span>
              {/if}
              <span class="account-handle" title={auth.handle}>{auth.handle}</span>
              <button class="btn-signout-inline" onclick={onsignout}>Sign out</button>
            </div>
          </div>
          {#if pendingDraft && (pendingDraft.events.length > 0 || pendingDraft.titleEvent)}
            {@render draftBar()}
          {/if}
          {#if listLoading}
            <p class="list-loading">Loading…</p>
          {:else if savedTimelines.length === 0}
            <p class="list-empty">No saved timelines yet.</p>
          {:else}
            <ul class="timeline-list">
              {#each savedTimelines as item (item.uri)}
                <li class="timeline-item">
                  {#if confirmDeleteUri === item.uri}
                    <div class="timeline-item-confirm">
                      <span class="confirm-label">Delete "{item.title}"?</span>
                      <button class="btn-confirm-delete"
                        onclick={() => handleDelete(item.uri)}
                        disabled={deletingUri === item.uri}>
                        {deletingUri === item.uri ? 'Deleting…' : 'Delete'}
                      </button>
                      <button class="btn-cancel-delete" onclick={() => (confirmDeleteUri = null)}>
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
                      onclick={() => (confirmDeleteUri = item.uri)}
                      disabled={!!openingUri || !!deletingUri}
                      aria-label="Delete {item.title}"
                    >✕</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      </div>

      <aside class="home-sidebar">
        <p>TimelineJS has been Knight Lab's most popular project. More than 1 million timelines have been created by people around the world and collectively they've been viewed over 1 billion times.</p>
        <p>A lot has changed since 2012 when it was released. We thought we'd try a little experiment to see how it might be different today.</p>
        <nav class="sidebar-docs" aria-label="Documentation">
        <h2>Documentation</h2>
          <a href="./docs.html#atmosphere" target="_blank" rel="noopener noreferrer">About Atmosphere</a>
          <a href="./docs.html#self-hosting" target="_blank" rel="noopener noreferrer">Self-hosting</a>
          <a href="./docs.html#data-format" target="_blank" rel="noopener noreferrer">Data format</a>
          <a href="./docs.html#media-types" target="_blank" rel="noopener noreferrer">Media types</a>
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
  .draft-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.2rem 1.25rem;
    background: #fffbeb;
    border-bottom: 1px solid #fcd34d;
    font-size: 0.8rem;
  }

  .draft-bar-label {
    flex: 1;
    color: #a16207;
    font-weight: 300;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .draft-bar-continue {
    background: #f59e0b;
    border: none;
    color: #fff;
    padding: 0.2rem 0.65rem;
    font-size: 0.78rem;
    font-family: inherit;
    font-weight: 600;
    text-transform: none;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
    margin: 0;
  }
  .draft-bar-continue:hover { background: #d97706; }

  .draft-bar-discard {
    background: transparent;
    border: none;
    color: #92400e;
    font-size: 0.78rem;
    font-family: inherit;
    font-weight: 400;
    text-transform: none;
    cursor: pointer;
    text-decoration: underline;
    padding: 0.2rem 0.5rem;
    flex-shrink: 0;
    margin: 0;
  }
  .draft-bar-discard:hover { color: #78350f; }

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

  .home-title {
    font-size: 1.75rem;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0;
    letter-spacing: -0.01em;
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

  .section-note { font-size: 0.875rem; color: #6b7280; line-height: 1.6; margin: 0; }

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

  .account-status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .account-avatar {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
    flex-shrink: 0;
  }

  .account-initials {
    background: #4b5563;
    color: #e5e7eb;
    font-size: 0.6rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .account-handle {
    font-size: 0.78rem;
    color: #6b7280;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btn-signout-inline {
    background: none;
    border: none;
    padding: 0.2rem 0.5rem;
    margin: 0;
    font-size: 0.78rem;
    font-family: inherit;
    color: #df4e13;
    text-decoration: underline;
    cursor: pointer;
  }
  .btn-signout-inline:hover { color: #b93e0d; }

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

  .btn-new {
    background: #df4e13;
    border: 1px solid #df4e13;
    color: #fff;
    padding: 0.5rem 1.25rem;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    font-weight: 500;
  }
  .btn-new:hover { background: #c44310; }

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

  .url-form { display: flex; gap: 0.5rem; }

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

  .import-error {
    font-size: 0.8rem;
    color: #b91c1c;
    margin: 0;
    line-height: 1.4;
  }

  .download-link { color: #2563eb; }

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

  .item-title { font-size: 0.9rem; color: #111; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .item-date { font-size: 0.75rem; color: #9ca3af; white-space: nowrap; flex-shrink: 0; }

  .clone-hint {
    font-size: 0.8rem;
    color: #9ca3af;
    margin: 0;
    line-height: 1.5;
  }
  .clone-link { color: #2563eb; }
  .clone-link:hover { color: #1d4ed8; }

  /* ── Responsive ──────────────────────────────────────────────── */
  @media (max-width: 700px) {
    .home-shell { height: 100dvh; }

    .home-layout {
      flex-direction: column;
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
      height: 320px;
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
</style>
