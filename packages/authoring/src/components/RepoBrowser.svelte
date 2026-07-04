<script lang="ts">
  import type { CollectionDef } from '../lib/collections.ts';
  import { collections as allCollections } from '../lib/collections.ts';
  import type { CollectionMediaItem } from '../lib/atproto.svelte.ts';
  import { listCollectionMedia, getCollectionItem, blobUrl, extractCid, getAuthState } from '../lib/atproto.svelte.ts';

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
  let nextCursor = $state<string | undefined>(undefined);
  let loading = $state(false);
  let loadError = $state('');
  let showAppInfo = $state(false);

  async function load(nsid: string, reset = false) {
    if (!nsid) return;
    loading = true;
    loadError = '';
    if (reset) { items = []; nextCursor = undefined; }
    try {
      const result = await listCollectionMedia(nsid, reset ? undefined : nextCursor);
      // Always suppress the selected item from paginated results — it's pinned at top on reset.
      const page = selectedUri
        ? result.items.filter(i => i.uri !== selectedUri)
        : result.items;
      if (reset) {
        const pinned = selectedUri ? await getCollectionItem(selectedUri) : null;
        items = pinned ? [pinned, ...page] : page;
      } else {
        items = [...items, ...page];
      }
      nextCursor = result.cursor;
    } catch (e) {
      loadError = String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (isSignedIn && hasCollections && activeNsid) {
      void load(activeNsid, true);
    }
  });

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
          onclick={() => { activeNsid = col.nsid; }}
        >{col.label}</button>
      {/each}
    </div>
  {/if}

  <div class="rb-body">
    {#if loading && items.length === 0}
      <p class="rb-status">Loading…</p>
    {:else if loadError}
      <p class="rb-status rb-status--error">{loadError}</p>
    {:else if items.length === 0}
      <p class="rb-status">No media found.</p>
    {:else}
      <div class="rb-grid">
        {#each items as item (item.uri)}
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
      {#if nextCursor}
        <div class="rb-more">
          <button type="button" class="rb-load-more" disabled={loading} onclick={() => load(activeNsid)}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
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

  /* ── Load more ── */
  .rb-more {
    text-align: center;
    padding: 0.6rem 0;
  }
  .rb-load-more {
    background: none;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.3rem 0.9rem;
    font-size: 0.75rem;
    font-family: inherit;
    color: #555;
    cursor: pointer;
    text-transform: none;
    font-weight: normal;
    margin-bottom: 0;
  }
  .rb-load-more:hover:not(:disabled) { border-color: #13a4df; color: #13a4df; }
  .rb-load-more:disabled { opacity: 0.5; cursor: default; }

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
