<script lang="ts">
  import { untrack } from 'svelte';
  import type { CollectionDef } from '../lib/collections.ts';
  import { collections as allCollections } from '../lib/collections.ts';
  import type { CollectionMediaItem } from '../lib/atproto.svelte.ts';
  import {
    fetchAllCollectionMedia, getCollectionItem, blobUrl, extractCid,
    getAuthState, getCurrentDid, MAX_COLLECTION_RECORDS,
  } from '../lib/atproto.svelte.ts';
  import { readCachedCollection, writeCachedCollection, isStale } from '../lib/mediaCache.ts';

  interface Props {
    availableCollections: CollectionDef[];
    onselect: (item: CollectionMediaItem) => void;
    initialNsid?: string;
    selectedUri?: string;
  }

  let { availableCollections, onselect, initialNsid, selectedUri }: Props = $props();

  const authState = $derived(getAuthState());
  const isSignedIn = $derived(authState.status === 'signed-in');
  const hasCollections = $derived(availableCollections.length > 0);

  function resolveInitialNsid(): string {
    if (initialNsid && availableCollections.some(c => c.nsid === initialNsid)) return initialNsid;
    return availableCollections[0]?.nsid ?? '';
  }

  let activeNsid = $state(resolveInitialNsid());
  let items = $state<CollectionMediaItem[]>([]);
  // The currently-selected item when it lives outside `items` — a different
  // collection, or a record that has since been deleted from this one.
  let pinned = $state<CollectionMediaItem | null>(null);
  let query = $state('');
  let loading = $state(false);    // nothing on screen yet
  let refreshing = $state(false); // showing cached items while revalidating
  let truncated = $state(false);
  let loadError = $state('');
  let showAppInfo = $state(false);

  // Bumped on every load so pages still arriving for an abandoned collection
  // (or a superseded refresh) can tell they've been overtaken.
  let loadToken = 0;

  async function load(nsid: string, force = false) {
    if (!nsid) return;
    const token = ++loadToken;
    const did = getCurrentDid();

    items = [];
    pinned = null;
    truncated = false;
    loadError = '';

    const cached = did && !force ? readCachedCollection(did, nsid) : null;
    if (cached) {
      items = cached.items;
      truncated = cached.truncated;
    }

    // A fresh cache entry is good enough on its own; a stale one still gets
    // shown immediately and quietly replaced when the walk finishes.
    if (cached && !isStale(cached)) {
      void resolvePinned(nsid, token);
      return;
    }

    loading = !cached;
    // Stays true past first paint: sibling context collections (Grain gallery
    // text, say) are still being joined after the thumbnails are on screen.
    refreshing = true;

    try {
      const result = await fetchAllCollectionMedia(nsid, {
        shouldContinue: () => token === loadToken,
        onPage: (page) => {
          // Only stream pages in when there's nothing on screen; replacing a
          // cached grid item-by-item would make it jump around.
          if (token !== loadToken || cached) return;
          items = [...items, ...page];
          loading = false;
        },
      });
      if (token !== loadToken || result.aborted) return;
      items = result.items;
      truncated = result.truncated;
      if (did) writeCachedCollection(did, nsid, result.items, result.truncated);
    } catch (e) {
      if (token !== loadToken) return;
      // A partial result still beats an error message.
      if (items.length === 0) loadError = String(e);
    } finally {
      if (token === loadToken) {
        loading = false;
        refreshing = false;
      }
    }

    void resolvePinned(nsid, token);
  }

  async function resolvePinned(nsid: string, token: number) {
    if (!selectedUri || items.some(i => i.uri === selectedUri)) return;
    const item = await getCollectionItem(selectedUri);
    if (token === loadToken && nsid === activeNsid) pinned = item;
  }

  function selectCollection(nsid: string) {
    if (nsid === activeNsid) return;
    query = '';
    activeNsid = nsid;
  }

  function refresh() {
    // Deliberately not `disabled` while in flight: disabling a focused button
    // blurs it, which the surrounding inline editor reads as "focus left" and
    // closes the whole media editor.
    if (loading || refreshing) return;
    void load(activeNsid, true);
  }

  $effect(() => {
    if (isSignedIn && hasCollections && activeNsid) {
      const nsid = activeNsid;
      untrack(() => void load(nsid));
    }
  });

  // Selected item first, so it stays visible without hunting for it.
  const orderedItems = $derived.by(() => {
    if (!selectedUri) return items;
    const idx = items.findIndex(i => i.uri === selectedUri);
    if (idx > 0) {
      const rest = items.slice();
      const [sel] = rest.splice(idx, 1);
      return [sel, ...rest];
    }
    if (idx === 0) return items;
    return pinned ? [pinned, ...items] : items;
  });

  const terms = $derived(query.trim().toLowerCase().split(/\s+/).filter(Boolean));

  function haystack(item: CollectionMediaItem): string {
    return item.searchText ?? `${item.label ?? ''} ${item.media.alt ?? ''}`.toLowerCase();
  }

  const visibleItems = $derived(
    terms.length === 0
      ? orderedItems
      : orderedItems.filter(item => {
          const hay = haystack(item);
          return terms.every(t => hay.includes(t));
        })
  );

  const isFiltered = $derived(terms.length > 0);

  function thumbUrl(item: CollectionMediaItem): string {
    if (item.media.blobRef) return blobUrl(extractCid(item.media.blobRef.ref));
    return item.media.url ?? '';
  }

  function isImage(item: CollectionMediaItem): boolean {
    return !!item.media.blobRef?.mimeType.startsWith('image/');
  }
</script>

{#if !isSignedIn}
  <div class="rb-info">
    <p class="rb-info-lead">Sign in to browse media from <a href="/docs.html#atmosphere">your atmosphere apps</a>.</p>
    <ul class="rb-app-list">
      {#each allCollections as col}
        <li>
          <a href={col.appUrl} target="_blank" rel="noopener noreferrer" class="rb-app-name">{col.label}</a>
          <span class="rb-app-desc"> — {col.description}</span>
        </li>
      {/each}
    </ul>
  </div>

{:else if !hasCollections}
  <div class="rb-info">
    <p class="rb-info-lead">No supported collections found in your account.</p>
    <p class="rb-info-sub">The following apps store media in your ATProto repo. Once you use one, it will appear here.</p>
    <ul class="rb-app-list">
      {#each allCollections as col}
        <li>
          <a href={col.appUrl} target="_blank" rel="noopener noreferrer" class="rb-app-name">{col.label}</a>
          <span class="rb-app-desc"> — {col.description}</span>
        </li>
      {/each}
    </ul>
  </div>

{:else}
  {#if availableCollections.length > 1}
    <div class="rb-tabs" role="tablist">
      {#each availableCollections as col}
        <button
          type="button"
          role="tab"
          class="rb-tab"
          class:active={activeNsid === col.nsid}
          aria-selected={activeNsid === col.nsid}
          onclick={() => selectCollection(col.nsid)}
        >{col.label}</button>
      {/each}
    </div>
  {/if}

  <div class="rb-toolbar">
    <input
      type="search"
      class="rb-filter"
      placeholder="Filter media…"
      aria-label="Filter media"
      bind:value={query}
    />
    <span class="rb-count" aria-live="polite">
      {#if loading}
        Loading…
      {:else if isFiltered}
        {visibleItems.length} of {orderedItems.length}
      {:else}
        {orderedItems.length}{truncated ? '+' : ''}
      {/if}
    </span>
    <button
      type="button"
      class="rb-refresh"
      class:rb-refresh--busy={loading || refreshing}
      aria-label="Reload from your PDS"
      title="Reload from your PDS"
      onclick={refresh}
    >↻</button>
  </div>

  <div class="rb-body">
    {#if loading && orderedItems.length === 0}
      <p class="rb-status">Loading…</p>
    {:else if loadError}
      <p class="rb-status rb-status--error">{loadError}</p>
    {:else if orderedItems.length === 0}
      <p class="rb-status">No media found.</p>
    {:else if visibleItems.length === 0}
      <p class="rb-status">Nothing matches “{query.trim()}”.</p>
    {:else}
      <div class="rb-grid">
        {#each visibleItems as item (item.uri)}
          <button
            type="button"
            class="rb-item"
            class:rb-item--selected={item.uri === selectedUri}
            onclick={() => onselect(item)}
            title={item.label ?? item.media.alt ?? ''}
          >
            <div class="rb-thumb-wrap">
              {#if isImage(item)}
                <img src={thumbUrl(item)} alt={item.media.alt ?? ''} class="rb-thumb" loading="lazy" />
              {:else}
                <div class="rb-audio-icon" aria-hidden="true">♪</div>
              {/if}
            </div>
            {#if item.label}
              <p class="rb-item-label">{item.label}</p>
            {/if}
          </button>
        {/each}
      </div>
      {#if truncated}
        <p class="rb-note">Showing the first {MAX_COLLECTION_RECORDS.toLocaleString()} records.</p>
      {/if}
    {/if}
  </div>

  <div class="rb-footer">
    <button type="button" class="rb-footer-trigger" onclick={() => (showAppInfo = !showAppInfo)}>
      Supported apps {showAppInfo ? '▲' : '▼'}
    </button>
    {#if showAppInfo}
      <div class="rb-footer-info">
        <ul class="rb-app-list">
          {#each allCollections as col}
            <li>
              <a href={col.appUrl} target="_blank" rel="noopener noreferrer" class="rb-app-name">{col.label}</a>
              <span class="rb-app-desc"> — {col.description}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* ── Info states (not signed in / no collections) ── */
  .rb-info {
    padding: 1rem 0.85rem 0.75rem;
  }
  .rb-info-lead {
    margin: 0 0 0.5rem;
    font-size: 0.82rem;
    font-weight: 600;
    color: #444;
  }
  .rb-info-sub {
    margin: 0 0 0.5rem;
    font-size: 0.78rem;
    color: #666;
    line-height: 1.45;
  }
  .rb-app-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .rb-app-list li {
    font-size: 0.78rem;
    line-height: 1.4;
    color: #555;
  }
  .rb-app-name {
    font-weight: 600;
    color: #13a4df;
    text-decoration: none;
  }
  .rb-app-name:hover { text-decoration: underline; }
  .rb-app-desc { color: #777; }

  /* ── Collection tabs (when multiple) ── */
  .rb-tabs {
    display: flex;
    border-bottom: 1px solid #e8e8e8;
    background: #fafafa;
  }
  .rb-tab {
    padding: 0.4rem 0.75rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: 500;
    color: #888;
    cursor: pointer;
    margin-bottom: 0;
    text-transform: none;
    transition: color 0.1s, border-color 0.1s;
  }
  .rb-tab:hover { color: #444; }
  .rb-tab.active { color: #13a4df; border-bottom-color: #13a4df; }

  /* ── Browser body ── */
  .rb-body {
    overflow-y: auto;
    max-height: 220px;
    padding: 0.6rem 0.6rem 0;
  }
  .rb-status {
    text-align: center;
    color: #888;
    font-size: 0.8rem;
    padding: 1.5rem 0;
    margin: 0;
  }
  .rb-status--error { color: #b91c1c; }

  /* ── Grid ── */
  .rb-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
    gap: 0.4rem;
  }
  .rb-item {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    border: 2px solid transparent;
    border-radius: 5px;
    overflow: hidden;
    cursor: pointer;
    padding: 0;
    background: none;
    text-align: left;
    transition: border-color 0.1s;
    margin-bottom: 0;
    font-weight: normal;
    text-transform: none;
  }
  .rb-item:hover { border-color: #13a4df; }
  .rb-item:focus { outline: 2px solid #13a4df; outline-offset: 2px; border-radius: 5px; }
  .rb-item--selected { border-color: #13a4df; }
  .rb-item--selected .rb-thumb-wrap::after {
    content: '✓';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 0.2rem 0.25rem;
    font-size: 0.7rem;
    color: #fff;
    background: linear-gradient(135deg, transparent 60%, rgba(19,164,223,0.7) 100%);
    pointer-events: none;
  }

  .rb-thumb-wrap {
    position: relative;
    aspect-ratio: 1;
    background: #f0f0f0;
    border-radius: 3px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .rb-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .rb-audio-icon {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    color: #bbb;
    background: #f5f5f5;
  }
  .rb-item-label {
    margin: 0;
    font-size: 0.65rem;
    line-height: 1.3;
    color: #555;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    padding: 0 2px 2px;
  }

  /* ── Toolbar (filter + count + reload) ── */
  .rb-toolbar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem 0;
  }
  .rb-filter {
    flex: 1 1 auto;
    min-width: 0;
    border: 1px solid #d8d8d8;
    border-radius: 4px;
    padding: 0.25rem 0.45rem;
    font-size: 0.75rem;
    font-family: inherit;
    color: #333;
    background: #fff;
    margin-bottom: 0;
  }
  .rb-filter:focus {
    outline: none;
    border-color: #13a4df;
    box-shadow: 0 0 0 2px rgba(19, 164, 223, 0.18);
  }
  .rb-filter::placeholder { color: #aaa; }
  .rb-count {
    flex: 0 0 auto;
    font-size: 0.68rem;
    color: #999;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .rb-refresh {
    flex: 0 0 auto;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 0.1rem 0.3rem;
    font-size: 0.85rem;
    line-height: 1.2;
    font-family: inherit;
    color: #999;
    cursor: pointer;
    text-transform: none;
    font-weight: normal;
    margin-bottom: 0;
  }
  .rb-refresh:hover { color: #13a4df; border-color: #d8d8d8; }
  .rb-refresh--busy {
    color: #13a4df;
    animation: rb-spin 0.9s linear infinite;
    cursor: default;
  }
  @keyframes rb-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .rb-refresh--busy { animation: none; opacity: 0.5; }
  }

  /* ── Truncation note ── */
  .rb-note {
    text-align: center;
    font-size: 0.68rem;
    color: #aaa;
    margin: 0;
    padding: 0.5rem 0 0.2rem;
  }

  /* ── Footer ── */
  .rb-footer {
    border-top: 1px solid #f0f0f0;
    padding: 0.3rem 0.85rem;
  }
  .rb-footer-trigger {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.68rem;
    font-family: inherit;
    color: #aaa;
    cursor: pointer;
    text-transform: none;
    font-weight: normal;
    margin-bottom: 0;
  }
  .rb-footer-trigger:hover { color: #888; }
  .rb-footer-info {
    padding: 0.5rem 0 0.2rem;
  }
</style>
