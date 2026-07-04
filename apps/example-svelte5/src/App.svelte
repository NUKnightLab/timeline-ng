<script lang="ts">
  import { onMount } from 'svelte';
  import { SlidePlayer, loadTimeline } from '@knight-lab/timeline-ng';
  import '@knight-lab/timeline-ng/styles.css';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';

  const DEFAULT_SRC = 'at://did:plc:xcinm6zyywmiymjyz67qgm72/com.knightlab.timeline/mr6t86qd66rf';
  const src = new URLSearchParams(window.location.search).get('src') ?? DEFAULT_SRC;

  let timeline = $state<TLTimeline | null>(null);
  let error = $state<string | null>(null);

  onMount(async () => {
    const result = await loadTimeline(src);
    if (result.ok) {
      timeline = result.timeline;
    } else {
      error = result.error;
    }
  });
</script>

{#if timeline}
  <SlidePlayer {timeline} />
{:else if error}
  <div class="status">Error loading timeline: {error}</div>
{:else}
  <div class="status" aria-busy="true">Loading…</div>
{/if}

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    height: 100%;
  }

  .status {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    font-family: system-ui, sans-serif;
    font-size: 0.95rem;
    color: #666;
  }
</style>
