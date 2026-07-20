<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { TLTimeline, TLEvent } from '@knight-lab/timeline-ng-core';
  import { getLocale, getMessage } from '@knight-lab/timeline-ng-core';
  import SlideContent from './SlideContent.svelte';
  import TimeNav from './TimeNav.svelte';
  import '../styles/base.css';

  interface Props {
    timeline: TLTimeline;
    language?: string;
    reverseOrder?: boolean;
    theme?: 'light' | 'dark' | 'auto';
    initialIndex?: number;
  }

  let {
    timeline,
    language = 'en',
    reverseOrder = false,
    theme = 'auto',
    initialIndex = 0,
  }: Props = $props();

  const slides: TLEvent[] = $derived.by(() => {
    const evs = reverseOrder ? [...timeline.events].reverse() : timeline.events;
    return timeline.title ? [timeline.title, ...evs] : evs;
  });

  let activeIndex = $state(untrack(() => initialIndex));
  $effect(() => {
    activeIndex = Math.max(0, Math.min(initialIndex, slides.length - 1));
  });
  let prevIndex = $state<number | null>(null);
  let direction = $state<'forward' | 'backward' | 'none'>('none');
  let stage: HTMLElement;
  let playerWidth = $state(800);

  const compact = $derived(playerWidth < 480);
  const minimal = $derived(playerWidth < 320);

  function pauseSlide(index: number) {
    const slideEl = stage?.children[index];
    if (!slideEl) return;
    slideEl.querySelectorAll<HTMLMediaElement>('audio, video').forEach(m => m.pause());
    slideEl.querySelectorAll<HTMLIFrameElement>('iframe').forEach(iframe => {
      const win = iframe.contentWindow;
      if (!win) return;
      const src = iframe.src;
      // YouTube (enablejsapi=1 required — added to embed URL)
      if (src.includes('youtube.com') || src.includes('youtu.be'))
        win.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
      // Vimeo
      if (src.includes('vimeo.com'))
        win.postMessage('{"method":"pause"}', 'https://player.vimeo.com');
      // SoundCloud
      if (src.includes('soundcloud.com'))
        win.postMessage('{"method":"pause"}', 'https://w.soundcloud.com');
      // DailyMotion
      if (src.includes('dailymotion.com'))
        win.postMessage(JSON.stringify({ command: 'pause' }), 'https://www.dailymotion.com');
    });
  }

  function goTo(index: number) {
    if (index === activeIndex || index < 0 || index >= slides.length) return;
    pauseSlide(activeIndex);
    direction = index > activeIndex ? 'forward' : 'backward';
    prevIndex = activeIndex;
    activeIndex = index;
  }

  const isFirst: boolean = $derived(activeIndex === 0);
  const isLast: boolean = $derived(activeIndex === slides.length - 1);

  // TimeNav always plots events chronologically (oldest→newest, left→right) — the
  // date axis itself never flips. The stage's own slide order does flip when
  // reverseOrder is on, so converting between "stage position" and "chronological
  // event index" needs this mapping in addition to the title-slide offset.
  // Flipping twice is a no-op, so the same formula works in both directions.
  function flipIndex(i: number): number {
    return reverseOrder ? timeline.events.length - 1 - i : i;
  }

  const navActiveIndex: number = $derived.by(() => {
    const stagePos = timeline.title ? activeIndex - 1 : activeIndex;
    return stagePos < 0 ? -1 : flipIndex(stagePos);
  });

  function handleNavigation(chronoIndex: number) {
    const stagePos = flipIndex(chronoIndex);
    goTo(timeline.title ? stagePos + 1 : stagePos);
  }

  const themeAttr: string | undefined = $derived(theme === 'auto' ? undefined : theme);

  const tl = $derived(getLocale(language));

  const liveLabel: string = $derived.by(() => {
    const slide = slides[activeIndex];
    const headline = slide?.text?.headline ?? '';
    const base = getMessage(tl, 'slide.label', { index: activeIndex + 1, total: slides.length });
    return headline ? `${base}: ${headline}` : base;
  });

  function handleKeydown(e: KeyboardEvent) {
    // A focused slide (tabindex=0 when active, for keyboard scrolling of long
    // content) should scroll natively on arrow keys, not trigger navigation.
    if ((e.target as HTMLElement | null)?.closest('.tl-slide')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(activeIndex + 1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); goTo(activeIndex - 1); }
  }

  let sectionEl: HTMLElement;

  // Vendor-prefixed fallbacks are for Safari, which as of writing still ships
  // only the `webkit`-prefixed Fullscreen API.
  let fsSupported = $state(false);
  let isFullscreen = $state(false);

  onMount(() => {
    const doc = document as Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element };
    // Reflects both browser support and the embedding iframe's `allow="fullscreen"`
    // permission — false in either case, so an unsupported/blocked context just
    // hides the button rather than showing one that silently fails.
    fsSupported = !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);

    const handleChange = () => {
      isFullscreen = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    };
  });

  function toggleFullscreen() {
    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      webkitExitFullscreen?: () => void;
    };
    const el = sectionEl as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
    } else {
      if (el.requestFullscreen) void el.requestFullscreen();
      else el.webkitRequestFullscreen?.();
    }
  }

  // Native `disabled` blurs a focused button with no fallback target, dropping
  // focus to <body>. Redirect it back to the player root when that's about to happen.
  function handlePrevClick(e: MouseEvent) {
    const hadFocus = document.activeElement === e.currentTarget;
    const targetIndex = activeIndex - 1;
    goTo(targetIndex);
    if (hadFocus && targetIndex <= 0) requestAnimationFrame(() => sectionEl?.focus());
  }

  function handleNextClick(e: MouseEvent) {
    const hadFocus = document.activeElement === e.currentTarget;
    const targetIndex = activeIndex + 1;
    goTo(targetIndex);
    if (hadFocus && targetIndex >= slides.length - 1) requestAnimationFrame(() => sectionEl?.focus());
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
  class="tl-player"
  data-tl-theme={themeAttr}
  onkeydown={handleKeydown}
  tabindex="0"
  aria-label={timeline.title?.text?.headline ?? getMessage(tl, 'timeline.label')}
  bind:clientWidth={playerWidth}
  bind:this={sectionEl}
>
  <div aria-live="polite" aria-atomic="true" class="tl-sr-only">{liveLabel}</div>

  <div class="tl-player__stage" bind:this={stage}>
    {#each slides as event, i}
      <SlideContent
        {event}
        active={i === activeIndex}
        direction={i === activeIndex ? direction : i === prevIndex ? (direction === 'forward' ? 'backward' : 'forward') : 'none'}
        index={i + 1}
        total={slides.length}
        locale={language}
      />
    {/each}

    <button
      class="tl-player__btn tl-player__btn--prev"
      onclick={handlePrevClick}
      disabled={isFirst}
    ><span aria-hidden="true">&#8249;</span><span class="tl-sr-only">{getMessage(tl, 'slide.prev')}</span></button>

    <button
      class="tl-player__btn tl-player__btn--next"
      onclick={handleNextClick}
      disabled={isLast}
    ><span aria-hidden="true">&#8250;</span><span class="tl-sr-only">{getMessage(tl, 'slide.next')}</span></button>

    {#if fsSupported}
      <button
        class="tl-player__btn tl-player__btn--fullscreen"
        onclick={toggleFullscreen}
        aria-pressed={isFullscreen}
        title={getMessage(tl, isFullscreen ? 'fullscreen.exit' : 'fullscreen.enter')}
      >
        {#if isFullscreen}
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 8 8 8 8 3" /><polyline points="21 8 16 8 16 3" /><polyline points="16 21 16 16 21 16" /><polyline points="8 21 8 16 3 16" /></svg>
        {:else}
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 3 3 3 3 8" /><polyline points="16 3 21 3 21 8" /><polyline points="21 16 21 21 16 21" /><polyline points="8 21 3 21 3 16" /></svg>
        {/if}
        <span class="tl-sr-only">{getMessage(tl, isFullscreen ? 'fullscreen.exit' : 'fullscreen.enter')}</span>
      </button>
    {/if}
  </div>

  <TimeNav
    {timeline}
    activeIndex={navActiveIndex}
    {language}
    {compact}
    {minimal}
    onnavigate={handleNavigation}
    onstart={() => goTo(0)}
    onend={() => goTo(slides.length - 1)}
  />
</section>

<style>
  .tl-player {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: var(--tl-min-height, 300px);
    outline: none;
    font-family: var(--tl-font-body);
    background: var(--tl-color-bg);
    color: var(--tl-color-text);
  }

  .tl-player:focus-visible {
    outline: 2px solid var(--tl-color-accent);
    outline-offset: -2px;
  }

  .tl-player__stage {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .tl-player__btn {
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--tl-btn-size, 2.5rem);
    padding: 0;
    background: transparent;
    color: #fff;
    border: none;
    font-size: 1.8rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    text-shadow: 0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6);
    transition: background var(--tl-transition-speed) ease,
                opacity var(--tl-transition-speed) ease;
    z-index: 10;
  }

  .tl-player__btn--prev { left: 0; }
  .tl-player__btn--next { right: 0; }

  .tl-player__btn--fullscreen {
    top: 0;
    right: 0;
    bottom: auto;
    left: auto;
    width: var(--tl-btn-size, 2.5rem);
    height: var(--tl-btn-size, 2.5rem);
    font-size: 1rem;
  }

  .tl-player__btn:hover:not(:disabled) { background: var(--tl-btn-bg-hover, rgba(0, 0, 0, 0.35)); }
  .tl-player__btn:disabled             { opacity: 0; pointer-events: none; }
  .tl-player__btn:focus-visible        { outline: 2px solid var(--tl-color-accent); outline-offset: -2px; }

  /* The base .tl-player rule's `position: relative` is author CSS, which beats the
     UA stylesheet's `:fullscreen { position: fixed }` regardless of specificity —
     author-origin declarations always win over user-agent-origin ones. Without
     re-declaring position/inset/margin here, the element gets promoted to the
     fullscreen top layer but keeps its old in-flow box, so it renders blank. */
  .tl-player:fullscreen,
  .tl-player:-webkit-full-screen {
    position: fixed;
    inset: 0;
    margin: 0;
    width: 100vw;
    height: 100vh;
    background: var(--tl-color-bg);
  }

  .tl-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }
</style>
