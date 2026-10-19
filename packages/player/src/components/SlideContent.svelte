<script lang="ts">
  import { onMount } from "svelte";
  import type { TLEvent } from "@knight-lab/timeline-ng-core";
  import {
    parseTLDate,
    formatDate,
    getLocale,
    getMessage,
    resolveBackgroundImageUrl,
  } from "@knight-lab/timeline-ng-core";
  import { sanitizeHtml } from "../lib/sanitize.js";
  import '../styles/prose.css';
  import MediaDisplay from "../media/MediaDisplay.svelte";

  interface Props {
    event: TLEvent;
    active?: boolean;
    direction?: "forward" | "backward" | "none";
    index: number;
    total: number;
    locale?: string;
  }

  let {
    event,
    active = false,
    direction = "none",
    index,
    total,
    locale = "en",
  }: Props = $props();
  let resolvedBackgroundUrl = $state<string | null>(null);
  let backgroundResolutionToken = 0;

  $effect(() => {
    const url = event.background?.url?.trim() ?? "";
    const token = ++backgroundResolutionToken;

    if (!url) {
      resolvedBackgroundUrl = null;
      return;
    }

    void resolveBackgroundImageUrl({ url }).then((src) => {
      if (token !== backgroundResolutionToken) return;
      if ((event.background?.url?.trim() ?? "") !== url) return;
      resolvedBackgroundUrl = src;
    });
  });

  const displayDate: string = $derived.by(() => {
    if (!event.start_date) return "";
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
      parts.push(
        `background-image: url(${JSON.stringify(resolvedBackgroundUrl)}); background-size: cover; background-position: center;`,
      );
    }
    if (event.background?.color)
      parts.push(`background-color: ${event.background.color};`);
    return parts.join(" ");
  });

  function colorLuminance(css: string): number {
    // Use Canvas to parse any CSS color format into RGB values
    const ctx = document.createElement("canvas").getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    const out = ctx.fillStyle; // '#rrggbb' or 'rgba(r, g, b, a)'
    let r: number, g: number, b: number;
    if (out.startsWith("#")) {
      r = parseInt(out.slice(1, 3), 16) / 255;
      g = parseInt(out.slice(3, 5), 16) / 255;
      b = parseInt(out.slice(5, 7), 16) / 255;
    } else {
      const m = out.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return 1;
      [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])].map(
        (v) => v / 255,
      );
    }
    // WCAG 2.1 relative luminance with gamma correction
    const lin = (v: number) =>
      v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  const hasDarkBg: boolean = $derived.by(() => {
    if (!event.background?.color) return false;
    return colorLuminance(event.background.color) < 0.35;
  });

  const hasImageBg: boolean = $derived(!!resolvedBackgroundUrl);

  const tl = $derived(getLocale(locale));
  const slideLabel = $derived(getMessage(tl, "slide.label", { index, total }));

  // Only a scrollable slide needs to be a tab stop at all — WCAG SCR29 makes it
  // focusable so keyboard users can reach the overflowed content, but a short slide
  // has nothing to scroll and should fall through to the player's own arrow-key nav.
  let articleEl: HTMLElement;
  let scrollable = $state(false);

  function measureScrollable() {
    if (articleEl) scrollable = articleEl.scrollHeight > articleEl.clientHeight;
  }

  onMount(() => {
    const ro = new ResizeObserver(measureScrollable);
    ro.observe(articleEl);
    measureScrollable();
    return () => ro.disconnect();
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<article
  class="tl-slide"
  class:tl-slide--active={active}
  class:tl-slide--forward={direction === "forward"}
  class:tl-slide--backward={direction === "backward"}
  class:tl-slide--dark-bg={hasDarkBg || hasImageBg}
  class:tl-slide--image-bg={hasImageBg}
  style={bgStyle}
  aria-hidden={!active}
  aria-label={slideLabel}
  role="region"
  tabindex={active && scrollable ? 0 : -1}
  inert={!active}
  bind:this={articleEl}
>
  <div
    class="tl-slide__inner"
    class:tl-slide__inner--has-media={hasMedia}
    class:tl-slide__inner--media-right={hasMedia &&
      event.media_position === "right"}
  >
    {#if event.media}
      <figure class="tl-slide__media">
        <MediaDisplay media={event.media} {locale} />
        {#if event.media.caption || event.media.credit}
          <figcaption class="tl-slide__media-caption">
            {#if event.media.credit}<cite class="tl-slide__media-credit"
                >{@html sanitizeHtml(event.media.credit)}</cite
              >{/if}
            {#if event.media.caption}<span class="tl-slide__media-caption-text"
                >{@html sanitizeHtml(event.media.caption)}</span
              >{/if}
          </figcaption>
        {/if}
      </figure>
    {/if}

    <div class="tl-slide__text">
      {#if displayDate}
        <p class="tl-slide__date">{displayDate}</p>
      {/if}
      {#if event.text?.headline}
        <h2 class="tl-slide__headline">
          {@html sanitizeHtml(event.text.headline)}
        </h2>
      {/if}
      {#if event.text?.text}
        <div class="tl-slide__body tl-prose">{@html sanitizeHtml(event.text.text)}</div>
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

  .tl-slide--forward {
    translate: 60px 0;
  }
  .tl-slide--backward {
    translate: -60px 0;
  }

  .tl-slide:focus-visible {
    outline: var(--tl-focus-ring-width, 2px) solid var(--tl-focus-ring-color, var(--tl-color-accent));
    outline-offset: calc(-1 * var(--tl-focus-ring-width, 2px));
  }

  .tl-slide--active {
    opacity: 1;
    translate: 0 0;
    pointer-events: auto;
  }

  /*
   * When slide has a dark or image background, flip text tokens.
   *
   * Every value here is a fallback rather than a literal, because this block
   * out-specifies anything inherited from .tl-player: declared as literals,
   * the whole dark-slide palette was beyond the reach of any skin, including
   * the contrast one.
   */
  .tl-slide--dark-bg {
    --tl-color-text: var(--tl-slide-dark-text, #f0f0f0);
    --tl-color-text-muted: var(--tl-slide-dark-text-muted, #cccccc);
    /*
     * Headline, body and date carry their own tokens now, so they have to be
     * flipped here too — inheriting --tl-color-text is no longer enough, and a
     * slide with a dark or image background would otherwise keep light-mode
     * body copy on a dark ground.
     *
     * The date is the one that was missed. Nothing sets --tl-date-color in the
     * default themes, so it fell through to --tl-color-text-muted above and
     * came out right by accident. The contrast skin does set it, at player
     * level, which defeated that fallback and left the date at #262626 on the
     * author's dark background — 1.09:1, the worst ratio in the player.
     */
    --tl-headline-color: var(--tl-slide-dark-headline, #ffffff);
    --tl-body-color: var(--tl-slide-dark-body, #e8e8e8);
    --tl-date-color: var(--tl-slide-dark-date, #cccccc);
  }

  /*
   * When a slide has an image background, scrim the text column.
   *
   * An image background always takes the light-text treatment above
   * (`hasDarkBg || hasImageBg`), so this scrim is the only thing standing
   * between light copy and whatever the author uploaded — and at the 40% it
   * used to be, the ratio was a property of the photo rather than of the
   * player. Over a pale image the date measured 1.84:1, the body 2.41:1 and
   * the headline 2.96:1, all failing 1.4.3, in both themes: the photo covers
   * the theme's own background, so the theme makes no difference here.
   *
   * 0.72 is the figure that holds for the *lightest possible* photo. The
   * binding case is the date, the faintest of the three at #cccccc, which
   * needs 0.659 against pure white to clear 4.5:1; 0.72 leaves some margin and
   * puts the three at 5.78:1, 7.58:1 and 9.29:1 in the worst case.
   *
   * It is a heavier panel than before, and that is the cost. The alternative
   * was to keep it light and lean on the blur or a text shadow, but neither is
   * a contrast mechanism WCAG will credit, and a ratio that holds only for
   * photos that happen to be dark is the bug being fixed. What makes 0.72
   * affordable is that the scrim covers this column alone: the image is still
   * fully visible around the text and behind the media, so the slide still
   * reads as a photo, not as a dark box.
   *
   * The blur is one token because the two properties disagreed — the standard
   * one said 2px and the -webkit- alias said 4px, so Safari blurred twice as
   * hard as everything else. It is decorative either way; none of the ratios
   * above depend on it.
   */
  .tl-slide--image-bg .tl-slide__text {
    background: var(--tl-slide-text-scrim, rgba(0, 0, 0, 0.72));
    backdrop-filter: blur(var(--tl-slide-text-scrim-blur, 2px));
    -webkit-backdrop-filter: blur(var(--tl-slide-text-scrim-blur, 2px));
    padding: 1.25rem 1.5rem;
    border-radius: var(--tl-radius, 4px);
  }

  .tl-slide__inner {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--tl-gap);
    align-items: var(--tl-slide-media-align, center);
    width: 100%;
    max-width: var(--tl-slide-max-width, 1100px);
    /*
     * Auto block margins center the content vertically in the stage, matching
     * TimelineJS 3. Unlike `justify-content: center` on the scroll container,
     * auto margins collapse to zero once the content overflows, so a long slide
     * still scrolls from its true top instead of clipping it out of reach.
     * Set --tl-slide-valign: 0 to pin content to the top instead.
     */
    margin: var(--tl-slide-valign, auto) auto;
  }

  /* Two-column only when media is present — explicit class avoids :has() */
  .tl-slide__inner--has-media {
    grid-template-columns: var(--tl-slide-media-col, 1fr) var(
        --tl-slide-text-col,
        1fr
      );
  }

  .tl-slide__inner--media-right {
    grid-template-columns: var(--tl-slide-text-col, 1fr) var(
        --tl-slide-media-col,
        1fr
      );
    direction: rtl;
  }
  .tl-slide__inner--media-right > * {
    direction: ltr;
  }

  .tl-slide__media {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
  }

  .tl-slide__media-caption {
    display: flex;
    flex-direction: column;
    color: var(--tl-color-text-muted);
  }

  .tl-slide__media-credit {
    display: block;
    text-align: right;
    font-size: calc(var(--tl-caption-size, 0.8rem) * 0.875);
  }

  .tl-slide__media-credit :global(p) {
    margin-block: .25em;
  }

  .tl-slide__media-caption-text {
    display: block;
    font-size: var(--tl-caption-size, 0.8rem);
    margin-top: 0.3rem;
  }

  .tl-slide__media-caption-text:first-child {
    margin-top: 0;
  }

  .tl-slide__text {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /*
   * The date used to render as a bold, uppercase, letter-spaced eyebrow, which
   * made it one of the loudest things on the slide — it should be the
   * quietest. Plain sentence case at reading size, following TimelineJS 3.
   * The old treatment is still reachable through the tokens.
   */
  .tl-slide__date {
    font-family: var(--tl-font-body);
    font-size: var(--tl-date-size, 0.9375rem);
    font-weight: var(--tl-date-weight, 400);
    letter-spacing: var(--tl-date-tracking, normal);
    text-transform: var(--tl-date-transform, none);
    color: var(--tl-date-color, var(--tl-color-text-muted));
    margin: 0;
  }

  .tl-slide__headline {
    font-family: var(--tl-font-heading);
    font-size: var(--tl-headline-size, clamp(1.2rem, 3cqi, 2.5rem));
    font-weight: var(--tl-headline-weight, 700);
    /* Five of the TimelineJS 3 font pairings set their headline in caps. */
    text-transform: var(--tl-headline-transform, none);
    color: var(--tl-headline-color, var(--tl-color-text));
    margin: 0;
    line-height: 1.2;
  }

  .tl-slide__body {
    font-size: var(--tl-body-size, 1rem);
    line-height: var(--tl-body-line-height, 1.65);
    color: var(--tl-body-color, var(--tl-color-text));
  }

  /*
   * Text-only slides. TimelineJS 3 narrowed and centered these; the default here
   * keeps them full-width and left-aligned. All three tokens default to the
   * no-op value, so a skin opts in by setting them together.
   */
  .tl-slide__inner:not(.tl-slide__inner--has-media) .tl-slide__text {
    text-align: var(--tl-slide-text-only-align, left);
    max-width: var(--tl-slide-text-only-width, 100%);
    margin-inline: var(--tl-slide-text-only-margin, 0);
  }



  @container tl-player (max-width: 600px) {
    /* Stack single-column: text first so the headline is visible without
       scrolling past media, regardless of media_position. */
    .tl-slide__inner--has-media {
      grid-template-columns: 1fr;
      direction: ltr;
    }
    .tl-slide__media {
      order: 2;
    }
    .tl-slide__text {
      order: 1;
    }
  }

  @container tl-player (max-width: 480px) {
    .tl-slide {
      padding: 1rem;
    }
    .tl-slide__text {
      gap: 0.5rem;
    }
  }
</style>
