<script lang="ts">
  import { onMount } from 'svelte';
  import { SlidePlayer, loadTimeline } from '@knight-lab/timeline-ng';
  import '@knight-lab/timeline-ng/styles.css';
  import { getPairing, DEFAULT_PAIRING } from '@knight-lab/timeline-ng-core';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';

  // Auto-focus is only appropriate when this page IS the destination the user
  // navigated to (a direct share link) — not when it's framed inside a host
  // page's iframe embed, where focus belongs to the host until the visitor
  // interacts with the embed themselves.
  const isTopLevel = window.self === window.top;

  const params = new URLSearchParams(window.location.search);
  const src = params.get('src');
  const isPreview = params.has('preview');
  const plcDirectory = params.get('plc') ?? undefined;
  const handleResolver = params.get('resolver') ?? undefined;

  let timeline = $state<TLTimeline | null>(null);
  let initialIndex = $state(0);
  let noSrc = $state(false);
  let loadErrorMessage = $state<string | null>(null);

  function addMetaTag(name: string, content: string): void {
    const tag = document.createElement('meta');
    tag.name = name;
    tag.content = content;
    document.head.appendChild(tag);
  }

  const loadErrorTimeline: TLTimeline = $derived({
    title: { text: { headline: loadErrorMessage ?? '' } },
    events: [],
  });

  const settings = $derived({
    language: 'en',
    theme: 'auto' as const,
    reverseOrder: false,
    ...(timeline?.settings ?? {}),
  });

  /*
   * Load the chosen pairing's faces from this origin. The files are mirrored
   * into public/fonts by scripts/fonts/fetch-fonts.mjs, so no request goes to
   * Google, and each stylesheet keeps Google's per-script unicode-range
   * declarations — the browser fetches only the slices this timeline's text
   * actually uses.
   *
   * Only pairings with `webfonts` get a stylesheet; the system-font pairing
   * has nothing to load. The link is swapped rather than accumulated, because
   * in preview mode the pairing changes every time the author picks a new one.
   */
  const FONT_LINK_ID = 'tl-font-pairing';

  $effect(() => {
    /* Resolve exactly as the player does, so the stylesheet always matches
       the tokens actually applied. */
    const pairing = getPairing(settings.fontPairing) ?? getPairing(DEFAULT_PAIRING);
    const existing = document.getElementById(FONT_LINK_ID);

    if (!pairing || pairing.webfonts.length === 0) {
      existing?.remove();
      return;
    }

    const href = new URL(`./fonts/${pairing.id}.css`, document.baseURI).href;
    if (existing instanceof HTMLLinkElement && existing.href === href) return;

    existing?.remove();
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });

  onMount(() => {
    if (isPreview) {
      const handler = (e: MessageEvent) => {
        if (e.source !== window.parent) return;
        const msg = e.data as { type: string; timeline: TLTimeline; initialIndex: number } | null;
        if (msg?.type === 'tl-preview') {
          timeline = msg.timeline;
          initialIndex = msg.initialIndex ?? 0;
        }
      };
      window.addEventListener('message', handler);
      return () => window.removeEventListener('message', handler);
    }

    if (!src) {
      noSrc = true;
      return;
    }
    void loadTimeline(src, { plcDirectory, handleResolver }).then(result => {
      if (result.ok) {
        timeline = result.timeline;
        initialIndex = result.timeline.settings?.initialIndex ?? 0;
        if (result.authorDid) {
          addMetaTag('at:canonical', result.uri);
          addMetaTag('at:author', `at://${result.authorDid}`);
        }
      } else {
        const notFound = result.error.includes('404') || result.error.includes('RecordNotFound') || result.error.toLowerCase().includes('not found');
        loadErrorMessage = notFound
          ? 'This timeline is no longer available.'
          : 'Could not load timeline.';
      }
    });
  });
</script>

{#if timeline}
  <SlidePlayer
    {timeline}
    {initialIndex}
    language={settings.language}
    theme={settings.theme}
    highContrast={settings.highContrast}
    fontPairing={settings.fontPairing}
    reverseOrder={settings.reverseOrder}
    autofocus={isTopLevel}
  />
{:else if loadErrorMessage}
  <SlidePlayer timeline={loadErrorTimeline} autofocus={isTopLevel} />
{:else if noSrc}
  <div class="embed-instructions">
    <h1>Timeline NG embed</h1>
    <p>This page renders a timeline embedded via a <code>src</code> URL parameter.</p>
    <p>Add one of the following to the URL:</p>
    <ul>
      <li><code>?src=at://...</code> — an AT Protocol URI for a timeline saved to a PDS</li>
      <li><code>?src=https://example.com/timeline.json</code> — a link to a hosted JSON file</li>
      <li><code>?src=https://docs.google.com/spreadsheets/.../pubhtml</code> — a Google Sheet published to the web</li>
    </ul>
    <p>
      See the <a href="../docs.html#self-hosting" target="_blank" rel="noopener">self-hosting guide</a>
      for details on generating and hosting timeline JSON.
    </p>
  </div>
{:else}
  <div class="embed-loading" aria-busy="true" aria-label="Loading timeline…"></div>
{/if}

<style>
  .embed-instructions {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    max-width: 480px;
    margin: 0 auto;
    padding: 2rem;
    font-family: system-ui, sans-serif;
    font-size: 0.9rem;
    line-height: 1.6;
    color: #444;
    box-sizing: border-box;
  }

  .embed-instructions h1 {
    font-size: 1.1rem;
    margin: 0 0 0.75rem;
    color: #111;
  }

  .embed-instructions code {
    background: #f0f0f0;
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.85em;
  }

  .embed-instructions a { color: #13a4df; }

  .embed-loading {
    height: 100%;
    background: #f0f0f0;
  }
</style>
