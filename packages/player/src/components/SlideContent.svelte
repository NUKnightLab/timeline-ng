<script lang="ts">
  import type { TLEvent } from '@knight-lab/timeline-ng-core';
  import { parseTLDate, formatDate, getLocale, getMessage, resolveBackgroundImageUrl } from '@knight-lab/timeline-ng-core';
  import { sanitizeHtml } from '../lib/sanitize.js';
  import MediaDisplay from '../media/MediaDisplay.svelte';

  interface Props {
    event: TLEvent;
    active?: boolean;
    direction?: 'forward' | 'backward' | 'none';
    index: number;
    total: number;
    locale?: string;
  }

  let { event, active = false, direction = 'none', index, total, locale = 'en' }: Props = $props();
  let resolvedBackgroundUrl = $state<string | null>(null);
  let backgroundResolutionToken = 0;

  $effect(() => {
    const url = event.background?.url?.trim() ?? '';
    const token = ++backgroundResolutionToken;

    if (!url) {
      resolvedBackgroundUrl = null;
      return;
    }

    void resolveBackgroundImageUrl({ url }).then((src) => {
      if (token !== backgroundResolutionToken) return;
      if ((event.background?.url?.trim() ?? '') !== url) return;
      resolvedBackgroundUrl = src;
    });
  });

  const displayDate: string = $derived.by(() => {
    if (!event.start_date) return '';
    if (event.start_date.display_date) return event.start_date.display_date;
    const start = formatDate(parseTLDate(event.start_date), locale);
    if (!event.end_date) return start;
    const end = formatDate(parseTLDate(event.end_date), locale);
    return end === start ? start : `${start}\u2013${end}`;
  });

  const hasMedia: boolean = $derived(!!event.media);

  const bgStyle: string = $derived.by(() => {
    const parts: string[] = [];
    if (resolvedBackgroundUrl) {
      parts.push(`background-image: url(${JSON.stringify(resolvedBackgroundUrl)}); background-size: cover; background-position: center;`);
    }
    if (event.background?.color) parts.push(`background-color: ${event.background.color};`);
    return parts.join(' ');
  });

  function colorLuminance(css: string): number {
    // Use Canvas to parse any CSS color format into RGB values
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    const out = ctx.fillStyle; // '#rrggbb' or 'rgba(r, g, b, a)'
    let r: number, g: number, b: number;
    if (out.startsWith('#')) {
      r = parseInt(out.slice(1, 3), 16) / 255;
      g = parseInt(out.slice(3, 5), 16) / 255;
      b = parseInt(out.slice(5, 7), 16) / 255;
    } else {
      const m = out.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 1;
      [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])].map(v => v / 255);
    }
    // WCAG 2.1 relative luminance with gamma correction
    const lin = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  const hasDarkBg: boolean = $derived.by(() => {
    if (!event.background?.color) return false;
    return colorLuminance(event.background.color) < 0.35;
  });

  const hasImageBg: boolean = $derived(!!resolvedBackgroundUrl);

  const tl = $derived(getLocale(locale));
  const slideLabel = $derived(getMessage(tl, 'slide.label', { index, total }));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<article
  class="tl-slide"
  class:tl-slide--active={active}
  class:tl-slide--forward={direction === 'forward'}
  class:tl-slide--backward={direction === 'backward'}
  class:tl-slide--dark-bg={hasDarkBg || hasImageBg}
  class:tl-slide--image-bg={hasImageBg}
  style={bgStyle}
  aria-hidden={!active}
  aria-label={slideLabel}
  role="region"
  tabindex={active ? 0 : -1}
>
  <div class="tl-slide__inner" class:tl-slide__inner--has-media={hasMedia} class:tl-slide__inner--media-right={hasMedia && event.media_position === 'right'}>
    {#if event.media}
      <figure class="tl-slide__media">
        <MediaDisplay media={event.media} {locale} />
        {#if event.media.caption || event.media.credit}
          <figcaption class="tl-slide__media-caption">
            {#if event.media.caption}<span>{@html sanitizeHtml(event.media.caption)}</span>{/if}
            {#if event.media.credit}<cite class="tl-slide__media-credit">{@html sanitizeHtml(event.media.credit)}</cite>{/if}
          </figcaption>
        {/if}
      </figure>
    {/if}

    <div class="tl-slide__text">
      {#if displayDate}
        <p class="tl-slide__date">{displayDate}</p>
      {/if}
      {#if event.text?.headline}
        <h2 class="tl-slide__headline">{@html sanitizeHtml(event.text.headline)}</h2>
      {/if}
      {#if event.text?.text}
        <div class="tl-slide__body">{@html sanitizeHtml(event.text.text)}</div>
      {/if}
    </div>
  </div>
</article>

<style>
  .tl-slide {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: var(--tl-slide-padding);
    /* The nav overlays the bottom of the stage, and its height varies as the
       user expands/collapses it — reserve at least that much space so
       scrolling to the end of the content always clears it. */
    padding-bottom: max(var(--tl-slide-padding), var(--tl-nav-overlap, 0px));
    overflow-y: auto;
    opacity: 0;
    translate: 60px 0;
    transition:
      opacity var(--tl-transition-speed) ease,
      translate var(--tl-transition-speed) ease,
      padding-bottom 0.2s ease;
    pointer-events: none;
  }

  .tl-slide--forward  { translate: 60px 0; }
  .tl-slide--backward { translate: -60px 0; }

  .tl-slide:focus-visible {
    outline: 2px solid var(--tl-color-accent);
    outline-offset: -2px;
  }

  .tl-slide--active {
    opacity: 1;
    translate: 0 0;
    pointer-events: auto;
  }

  /* When slide has a dark or image background, flip text tokens */
  .tl-slide--dark-bg {
    --tl-color-text: #f0f0f0;
    --tl-color-text-muted: #cccccc;
  }

  /* When slide has an image background, scrim the text column for readability */
  .tl-slide--image-bg .tl-slide__text {
    background: var(--tl-slide-text-scrim, rgba(0, 0, 0, 0.4));
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(4px);
    padding: 1.25rem 1.5rem;
    border-radius: var(--tl-radius, 4px);
  }

  .tl-slide__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--tl-gap);
    align-items: start;
    width: 100%;
    max-width: var(--tl-slide-max-width, 1100px);
    margin: 0 auto;
  }

  /* Two-column only when media is present — explicit class avoids :has() */
  .tl-slide__inner--has-media {
    grid-template-columns: var(--tl-slide-media-col, 1fr) var(--tl-slide-text-col, 1fr);
  }

  .tl-slide__inner--media-right {
    grid-template-columns: var(--tl-slide-text-col, 1fr) var(--tl-slide-media-col, 1fr);
    direction: rtl;
  }
  .tl-slide__inner--media-right > * { direction: ltr; }

  .tl-slide__media {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 0;
  }

.tl-slide__media-caption {
    font-size: var(--tl-caption-size, 0.8rem);
    color: var(--tl-color-text-muted);
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .tl-slide__text {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .tl-slide__date {
    font-family: var(--tl-font-body);
    font-size: var(--tl-date-size, 0.8rem);
    font-weight: var(--tl-date-weight, 600);
    letter-spacing: var(--tl-date-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--tl-date-color, var(--tl-color-text-muted));
    margin: 0;
  }

  .tl-slide__headline {
    font-family: var(--tl-font-heading);
    font-size: var(--tl-headline-size, clamp(1.2rem, 3cqi, 2.5rem));
    font-weight: var(--tl-headline-weight, 700);
    color: var(--tl-color-text);
    margin: 0;
    line-height: 1.2;
  }

  .tl-slide__body {
    font-size: var(--tl-body-size, 1rem);
    line-height: var(--tl-body-line-height, 1.65);
    color: var(--tl-color-text);
  }

  /*
   * These target user-authored HTML inside body copy — unavoidably "deep".
   * Customise via --tl-body-link-color and --tl-color-accent.
   */
  .tl-slide__body :global(p)            { margin: 0 0 0.75rem; }
  .tl-slide__body :global(p:last-child) { margin-bottom: 0; }
  .tl-slide__body :global(a)            { color: var(--tl-body-link-color, var(--tl-color-accent)); }

  @container tl-player (max-width: 600px) {
    /* Stack single-column: text first so the headline is visible without
       scrolling past media, regardless of media_position. */
    .tl-slide__inner--has-media {
      grid-template-columns: 1fr;
      direction: ltr;
    }
    .tl-slide__media { order: 2; }
    .tl-slide__text { order: 1; }
  }

  @container tl-player (max-width: 480px) {
    .tl-slide { padding: 1rem; }
    .tl-slide__text { gap: 0.5rem; }
  }
</style>
