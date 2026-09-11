<script lang="ts">
  import type { TLEvent, TLTimeline, TLSettings } from '@knight-lab/timeline-ng-core';
  import type * as Y from 'yjs';
  import type { SlideEntry } from '../lib/doc.ts';
  import { fly } from 'svelte/transition';
  import { tick } from 'svelte';
  import { setHistoryHandler } from '../lib/historyBus.ts';
  import type { HistoryDirection } from '../lib/historyBus.ts';
  import type { HistoryTarget } from '../lib/historyTarget.ts';

  import EventList from './EventList.svelte';
  import EventEditor from './EventEditor.svelte';
  import AppNavbar from './AppNavbar.svelte';
  import AuthButton from './AuthButton.svelte';
  import HelpLink from './HelpLink.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import { getAuthState } from '../lib/atproto.svelte.ts';
  import { getPairing, DEFAULT_PAIRING } from '@knight-lab/timeline-ng-core';


  interface Props {
    timelineTitle: string;
    titleEvent: TLEvent | null;
    /** Slides in display order, each with the internal key that identifies it. */
    entries: SlideEntry[];
    /** An internal slide key, or `'title'`. Never a `unique_id`. */
    selectedId: string | null;
    selectedEvent: TLEvent | null;
    isEditingTitle: boolean;
    timeline: TLTimeline;
    atUri: string | null;
    pdsClean: boolean;
    publishStatus: string | null;
    canPublish: boolean;
    deletedItem: { event: TLEvent; isTitle: boolean; sortedIndex: number } | null;
    deletedItemLeaving: boolean;
    settings: TLSettings;
    onback: () => void;
    onsignout: () => void;
    ontitlechange: (title: string) => void;
    onselect: (id: string) => void;
    onadd: () => void;
    onaddtitle: () => void;
    ondelete: (id: string) => void;
    onupdate: (event: TLEvent) => void;
    onpublish: () => void;
    onexport: () => void;
    onexportcsv: () => void;
    onundo: () => void;
    /** What undo or redo would change next — read before applying, so it can be revealed first. */
    onpeekhistory: (direction: HistoryDirection) => HistoryTarget | null;
    /** Apply an undo or redo. Returns whether anything changed. */
    onapplyhistory: (direction: HistoryDirection) => boolean;
    /** Bumped after each undo or redo, so the slide editor re-reads its fields. */
    historyVersion: number;
    headlineFragment?: Y.XmlFragment | null;
    bodyFragment?: Y.XmlFragment | null;
    onsettingschange: (patch: Partial<TLSettings>) => void;
  }

  let {
    timelineTitle, titleEvent, entries, selectedId, selectedEvent, isEditingTitle,
    timeline, atUri, pdsClean, publishStatus, canPublish, deletedItem, deletedItemLeaving, settings,
    headlineFragment = null, bodyFragment = null,
    onback, onsignout, ontitlechange, onselect, onadd, onaddtitle, ondelete, onupdate, onpublish, onexport, onexportcsv, onundo,
    onsettingschange, onpeekhistory, onapplyhistory, historyVersion,
  }: Props = $props();

  /**
   * The timeline's own font tokens, as an inline style declaration.
   *
   * The pairing data lives in core and already carries the `--tl-*` values the
   * player uses, so the editor can set prose in the face it will be published
   * in without importing any player CSS — and the two cannot drift, because
   * they read the same source. Custom properties inherit, so declaring them on
   * the shell reaches every editor below it.
   */
  const fontTokens = $derived(
    Object.entries(
      (getPairing(settings.fontPairing) ?? getPairing(DEFAULT_PAIRING)!).tokens,
    )
      .map(([k, v]) => `${k}:${v}`)
      .join(';'),
  );

  /* Every slide ID except the one being edited — so the editor can offer a
     generated ID that will not collide with a slide the author already has. */
  const otherSlideIds = $derived(
    [titleEvent?.unique_id, ...entries.map(e => e.event.unique_id)]
      .filter((id): id is string => !!id && id !== selectedEvent?.unique_id),
  );

  const SIZE_PRESETS: { label: string; width: number }[] = [
    { label: 'Small', width: 300 },
    { label: 'Mobile', width: 375 },
    { label: 'Tablet', width: 600 },
    { label: 'Desktop', width: 1100 },
  ];

  const _embedMeta = document.querySelector('meta[name="tl-embed-base"]')?.getAttribute('content');
  const EMBED_BASE = (_embedMeta && !_embedMeta.startsWith('__')) ? _embedMeta : 'http://127.0.0.1:5200/';
  const EMBED_ORIGIN = (() => { try { return new URL(EMBED_BASE).origin; } catch { return EMBED_BASE; } })();
  const _shareMeta = document.querySelector('meta[name="tl-share-base"]')?.getAttribute('content');
  const SHARE_BASE = (_shareMeta && !_shareMeta.startsWith('__')) ? _shareMeta : 'http://localhost:8787/ng/share';
  const previewUrl = `${EMBED_BASE}?preview`;
  const EMBED_PLC = import.meta.env.VITE_ATPROTO_PLC_URL as string | undefined;
  const EMBED_RESOLVER = import.meta.env.VITE_ATPROTO_HANDLE_RESOLVER as string | undefined;

  const auth = $derived(getAuthState());

  let showEventList = $state(false);
  let showPreview = $state(false);
  let previewIframeEl = $state<HTMLIFrameElement | null>(null);
  let previewIframeReady = $state(false);
  let showSettingsPanel = $state(false);
  let previewWidth = $state<number | null>(null);
  let previewPlayerEl = $state<HTMLDivElement | null>(null);
  let backdropWidth = $state(0);

  // What "Full" actually resolves to given the current window — presets wider
  // than this wouldn't render any differently, so don't offer them as if they
  // were a distinct, reachable size (e.g. "Desktop" on a tablet-width editor).
  const availableBoxWidth = $derived(backdropWidth > 0 ? Math.min(1200, backdropWidth - 64) : 1200);
  const visiblePresets = $derived(SIZE_PRESETS.filter(p => p.width <= availableBoxWidth));

  $effect(() => {
    if (!showPreview) {
      previewIframeReady = false;
      showSettingsPanel = false;
      previewWidth = null;
    }
  });

  // If the window shrinks while a preset wider than what now fits is active
  // (e.g. "Desktop" selected, then the browser is resized down), fall back to
  // Full rather than leaving the player clamped/clipped at a stale width.
  $effect(() => {
    if (previewWidth !== null && previewWidth > availableBoxWidth) {
      previewWidth = null;
    }
  });

  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = previewPlayerEl?.getBoundingClientRect().width ?? 800;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const delta = ev.clientX - startX;
      previewWidth = Math.max(280, Math.min(1200, Math.round(startWidth + delta)));
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    }
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  }

  $effect(() => {
    if (!previewIframeReady || !previewIframeEl) return;
    previewIframeEl.contentWindow?.postMessage(
      { type: 'tl-preview', timeline: $state.snapshot(timeline), initialIndex: previewStartIndex },
      EMBED_ORIGIN
    );
  });

  $effect(() => {
    if (!showPreview && !showShare) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { showPreview = false; showShare = false; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  let showShare = $state(false);
  let warnBack = $state(false);
  let copiedEmbed = $state<'uri' | 'iframe' | 'aturi' | null>(null);
  let editingTitle = $state(false);
  let titleInputEl = $state<HTMLInputElement | null>(null);

  $effect(() => { if (editingTitle) titleInputEl?.focus(); });

  function commitTitle(val: string) {
    ontitlechange(val.trim());
    editingTitle = false;
  }

  const previewStartIndex = $derived.by(() => {
    if (selectedId === 'title' && titleEvent) return 0;
    const idx = entries.findIndex(e => e.key === selectedId);
    if (idx === -1) return 0;
    return titleEvent ? idx + 1 : idx;
  });

  function openPreview() {
    showShare = false;
    showPreview = true;
  }

  function openSettings() {
    showShare = false;
    showPreview = true;
    showSettingsPanel = true;
  }

  // ── Undo and redo: reveal, then apply, then flash ────────────────────────────
  //
  // docs/phase1-undo.md. Everything that decides *where* a change is shown lives
  // here, because this component owns the panels and hands out the selection.

  /**
   * Pause between bringing something into view and changing it. (feel)
   *
   * 250ms was too quick to follow: the slide changed and the edit vanished as
   * one motion. Only applied when the view actually had to move — undoing in
   * the field you are already typing in stays immediate.
   */
  const REVEAL_PAUSE_MS = 450;
  let historyBusy = false;

  function slideExists(key: string): boolean {
    return key === 'title' ? !!titleEvent : entries.some((e) => e.key === key);
  }

  /** The on-screen element that shows a target, trying the edit control before its read-only view. */
  function revealElementFor(target: HistoryTarget): HTMLElement | null {
    const q = (sel: string) => document.querySelector<HTMLElement>(sel);
    if (target.kind === 'settings') {
      const panel = q('.settings-panel');
      if (!panel) return null;
      // The field wrapper, not the control: a native <select> barely shows a
      // background change, and the whole panel flashing says only that
      // *something* changed.
      if (target.setting) {
        return panel.querySelector<HTMLElement>(`[data-setting="${target.setting}"]`) ?? panel;
      }
      return panel;
    }
    if (target.kind === 'title') return q('.subnav-title-btn') ?? q('.subnav-title-input');
    if (target.field === 'slide') return q(`[data-slide-id="${target.slideKey}"]`);

    const panel = document.getElementById('event-editor-panel');
    const at = (sel: string) => panel?.querySelector<HTMLElement>(sel) ?? null;
    switch (target.field) {
      case 'headline':   return at('#headline-rte') ?? at('.slide-h');
      case 'body':       return at('#body-rte') ?? at('.slide-body-text');
      case 'caption':    return at('#caption-rte') ?? at('.slide-caption-text') ?? at('.slide-media-col');
      case 'credit':     return at('#credit-rte') ?? at('.slide-credit-text') ?? at('.slide-media-col');
      case 'alt':        return at('#media-alt') ?? at('.slide-media-col');
      case 'media':      return at('.slide-media-col');
      case 'date':       return at('.field-panel-body--date') ?? at('.slide-date-summary');
      case 'background': return at('#bg-color-text');
      case 'slideId':    return at('#slide-id');
      case 'group':      return at('#group');
      default:           return panel;
    }
  }

  function isInView(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= (window.innerHeight || document.documentElement.clientHeight);
  }

  function flash(el: HTMLElement | null | undefined) {
    if (!el) return;
    el.classList.remove('tl-history-flash');
    void el.offsetWidth;   // restart the animation when the same element flashes twice
    el.classList.add('tl-history-flash');
    // A timer rather than animationend: with reduced motion there is no animation
    // to end, and the outline that replaces it would otherwise stay forever.
    setTimeout(() => el.classList.remove('tl-history-flash'), 800);
  }

  async function performHistory(direction: HistoryDirection) {
    // Holding Cmd-Z auto-repeats. Each step waits on a reveal, so overlapping
    // them would apply changes against a view that has not caught up.
    if (historyBusy) return;
    historyBusy = true;
    try {
      const target = onpeekhistory(direction);

      // A change with no recognisable place still applies; there is just
      // nothing to bring into view. An empty stack applies nothing — D10.
      if (!target) {
        onapplyhistory(direction);
        return;
      }

      // Restoring a deleted slide, or redoing an added one: it does not exist
      // yet, so there is nothing to reveal until the change has been applied.
      if (target.kind === 'slide' && target.field === 'slide' && !slideExists(target.slideKey)) {
        showPreview = false;
        showShare = false;
        if (!onapplyhistory(direction)) return;
        onselect(target.slideKey);   // D7
        await tick();
        flash(revealElementFor(target));
        return;
      }

      let moved = false;

      // D9: overlays close first — except the one holding the target. Settings
      // live inside the preview overlay, so revealing a settings change means
      // opening it, where every other target means closing it.
      if (target.kind === 'settings') {
        if (!showPreview || !showSettingsPanel) { openSettings(); moved = true; }
      } else if (showPreview || showShare) {
        showPreview = false;
        showShare = false;
        moved = true;
      }

      if (target.kind === 'slide' && target.slideKey !== selectedId) {
        onselect(target.slideKey);
        moved = true;
      }

      await tick();
      const before = revealElementFor(target);
      if (before && !isInView(before)) {
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        before.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
        moved = true;
      }
      if (moved) {
        // Mark the target before changing it, as well as after. An undo that
        // empties a field leaves nothing to flash once it has been applied, so
        // without this the moment of the change is invisible.
        flash(before);
        await new Promise((resolve) => setTimeout(resolve, REVEAL_PAUSE_MS));
      }

      if (!onapplyhistory(direction)) return;
      await tick();

      // Look again: re-reading fields can replace the element that was shown.
      const after = revealElementFor(target) ?? before;
      flash(after);
      // D4: focus follows only when the view had to move to find the change.
      if (moved) after?.focus?.({ preventScroll: true });
    } finally {
      historyBusy = false;
    }
  }

  $effect(() => {
    const unregister = setHistoryHandler((direction) => {
      void performHistory(direction);
      return true;
    });

    const onKey = (e: KeyboardEvent) => {
      // A rich-text field already took it: Tiptap's keymap runs first, calls
      // requestHistory, and ProseMirror marks the event handled.
      if (e.defaultPrevented) return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const direction: HistoryDirection | null =
        key === 'z' ? (e.shiftKey ? 'redo' : 'undo') :
        key === 'y' && !e.shiftKey ? 'redo' :
        null;
      if (!direction) return;
      // D1: one stack. A plain input's native undo would be a second, private
      // one that knows nothing of the rest of the timeline.
      e.preventDefault();
      void performHistory(direction);
    };

    window.addEventListener('keydown', onKey);
    return () => {
      unregister();
      window.removeEventListener('keydown', onKey);
    };
  });

  const embedUrl = $derived.by(() => {
    if (!atUri) return '';
    const p = new URLSearchParams({ src: atUri });
    if (EMBED_PLC) p.set('plc', EMBED_PLC);
    if (EMBED_RESOLVER) p.set('resolver', EMBED_RESOLVER);
    return `${EMBED_BASE}?${p}`;
  });

  // Points at the OG-preview worker rather than the embed page directly —
  // this is the URL meant to be pasted/shared standalone (Slack, social,
  // email), where social-preview meta tags matter. The iframe snippet above
  // still embeds the player directly; nested-iframe OG tags aren't seen by
  // crawlers anyway, so there's nothing to gain by routing that through here.
  const shareUrl = $derived.by(() => {
    if (!atUri) return '';
    const p = new URLSearchParams({ src: atUri });
    if (EMBED_PLC) p.set('plc', EMBED_PLC);
    if (EMBED_RESOLVER) p.set('resolver', EMBED_RESOLVER);
    return `${SHARE_BASE}?${p}`;
  });

  const iframeCode = $derived(
    atUri ? `<iframe src="${embedUrl}" width="100%" height="650" frameborder="0" allowfullscreen></iframe>` : ''
  );

  function handleBack() {
    if (!pdsClean && atUri && auth.status === 'signed-in') {
      warnBack = true;
      setTimeout(() => { warnBack = false; onback(); }, 1500);
    } else {
      onback();
    }
  }

  function copyEmbed(text: string, which: 'uri' | 'iframe' | 'aturi') {
    void navigator.clipboard.writeText(text).then(() => {
      copiedEmbed = which;
      setTimeout(() => { copiedEmbed = null; }, 2000);
    });
  }
</script>

<!--
  The timeline's own font tokens, so the editor sets prose in the face it will
  be published in. The pairing data lives in core and already carries the
  `--tl-*` values the player uses, so this needs no player CSS and cannot drift
  from it — the two read the same source. Custom properties inherit, so
  declaring them here reaches every editor below.
-->
<div
  class="editor-shell"
  class:show-eventlist={showEventList}
  class:show-share={showShare}
  style={fontTokens}
>

  <!-- ── Navbar ─────────────────────────────────────────────────────────────── -->
  <AppNavbar />

  <!-- ── Sub-nav ──────────────────────────────────────────────────────────── -->
  <nav class="subnav" aria-label="Editor actions">
    <button class="btn-back" onclick={handleBack}>← Back</button>
    <span class="subnav-divider" aria-hidden="true">|</span>
    {#if editingTitle}
      <input
        class="subnav-title-input"
        bind:this={titleInputEl}
        value={timelineTitle}
        placeholder="Untitled timeline"
        onblur={(e) => commitTitle((e.target as HTMLInputElement).value)}
        onkeydown={(e) => { if (e.key === 'Enter') commitTitle((e.target as HTMLInputElement).value); if (e.key === 'Escape') editingTitle = false; }}
      />
    {:else}
      <button class="subnav-title-btn" onclick={() => (editingTitle = true)} title="Click to edit title">
        <span class="title-text">{timelineTitle || 'Untitled timeline'}</span><span class="title-pencil" aria-hidden="true">✎</span>
      </button>
    {/if}
    {#if warnBack}
      <span class="warn-back" role="alert">Unpublished changes — kept in this browser</span>
    {/if}
    <div class="subnav-actions">
      <button class="btn-events" onclick={() => { showEventList = !showEventList; showShare = false; }}>
        Events ▾
      </button>
      <button class="btn-settings" onclick={openSettings} title="Timeline settings — published with your timeline" aria-label="Settings">
        <span aria-hidden="true">⚙</span><span class="btn-settings__label">Settings</span>
      </button>
      <button class="btn-preview" onclick={openPreview}>
        Preview
      </button>
      {#if publishStatus}
        <span class="publish-status">{publishStatus}</span>
      {:else if pdsClean && atUri && auth.status === 'signed-in'}
        <span class="publish-status">Published ✓</span>
      {:else}
        <button class="btn-publish" onclick={onpublish} disabled={!canPublish}
          title={canPublish ? 'Publish to your PDS' : 'Sign in to publish'}>
          {atUri ? 'Publish changes' : 'Publish'}
        </button>
      {/if}
      <button class="button button-complement btn-share" onclick={() => { showPreview = false; showShare = !showShare; }}
        aria-pressed={showShare}
        disabled={entries.length === 0 && !titleEvent}>
        Share<span class="btn-share__arrow" aria-hidden="true"> ▾</span>
      </button>
    </div>
    <div class="subnav-auth">
      <AuthButton {onsignout} />
    </div>
  </nav>

  <!-- ── Publish drawer ──────────────────────────────────────────────────────── -->
  {#if showShare}
    <div class="share-panel">

      <!-- Section 1: how to share what is published -->
      <div class="share-section">
        <h3 class="share-section__title">Share</h3>
        {#if atUri && auth.status === 'signed-in'}
          {#if !pdsClean}
            <p class="share-section__warn">Unpublished changes — publish again to update the public version.</p>
          {/if}
          <div class="share-code-row">
            <span class="share-code-label">Embed</span>
            <code class="share-code">{iframeCode}</code>
            <button class="btn-copy" onclick={() => copyEmbed(iframeCode, 'iframe')}>
              {copiedEmbed === 'iframe' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div class="share-code-row">
            <span class="share-code-label">Direct link</span>
            <code class="share-code">{shareUrl}</code>
            <button class="btn-copy" onclick={() => copyEmbed(shareUrl, 'uri')}>
              {copiedEmbed === 'uri' ? 'Copied!' : 'Copy'}
            </button>

          </div>
          <div class="share-code-row">
            <span class="share-code-label">AT URI</span>
            <code class="share-code">{atUri}</code>
            <button class="btn-copy" onclick={() => copyEmbed(atUri!, 'aturi')}>
              {copiedEmbed === 'aturi' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        {:else if auth.status === 'signed-in'}
          <p class="share-section__body"><strong>Publish</strong> your timeline to the <HelpLink doc="atmosphere">ATmosphere network</HelpLink> to get a link and an embed snippet. Anyone with the link will be able to read it.</p>
        {:else}
          <p class="share-section__body"><HelpLink doc="atmosphere">Sign in</HelpLink> to publish your timeline. You'll get a direct link to view it and an embed snippet to use anywhere.</p>
        {/if}
      </div>

      <!-- Sections 3 & 4: download tiles, side by side at reasonably wide views -->
      <div class="share-section-row">
        <div class="share-section">
          <h3 class="share-section__title">Download as JSON</h3>
          <p class="share-section__body">Download a portable copy of your timeline data. You can self-host the player on your own site without needing a atmosphere account — see the <HelpLink doc="self-hosting">self-hosting guide</HelpLink> for setup instructions.</p>
          <button class="btn-download" onclick={onexport}>Download JSON</button>
        </div>

        <div class="share-section">
          <h3 class="share-section__title">Download as CSV</h3>
          <p class="share-section__body">Don't have a server, don't want an atmosphere account? Import this download into a blank Google Sheet, then use File → Share → "Publish to the web" to get a link — paste that into <strong>From URL</strong> on the home page to get an embed code or direct link.</p>
          <button class="btn-download" onclick={onexportcsv}>Download CSV</button>
        </div>
      </div>

    </div>
  {/if}

  <!-- ── Preview lightbox ────────────────────────────────────────────────────── -->
  {#if showPreview}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="preview-backdrop" role="dialog" aria-modal="true" aria-label="Timeline preview"
      onclick={(e) => e.target === e.currentTarget && (showPreview = false)}
      bind:clientWidth={backdropWidth}>
      <div class="preview-box">
        <div class="preview-box__chrome">
          <span class="preview-drawer__label">Preview</span>
          {#if !pdsClean && atUri && auth.status === 'signed-in'}
            <span class="preview-drawer__warn">Unpublished changes</span>
          {/if}
          <div class="preview-size-presets" role="group" aria-label="Preview width">
            {#each visiblePresets as preset (preset.label)}
              <button
                type="button"
                class="preview-size-btn"
                class:active={previewWidth === preset.width}
                onclick={() => (previewWidth = preset.width)}
              >{preset.label}</button>
            {/each}
            <button
              type="button"
              class="preview-size-btn"
              class:active={previewWidth === null}
              onclick={() => (previewWidth = null)}
            >Full</button>
          </div>
          <div class="preview-chrome-right">
            <button
              type="button"
              class="preview-settings-toggle"
              class:active={showSettingsPanel}
              aria-pressed={showSettingsPanel}
              onclick={() => (showSettingsPanel = !showSettingsPanel)}
            >⚙ {showSettingsPanel ? 'Hide settings' : 'Settings'}</button>
            <span class="preview-chrome-sep" aria-hidden="true"></span>
            <button class="preview-drawer__close" onclick={() => (showPreview = false)} aria-label="Close preview" title="Close preview">✕ Preview</button>
          </div>
        </div>
        <div class="preview-box__stage" class:settings-open={showSettingsPanel}>
          <div
            class="preview-box__player"
            class:sized={previewWidth !== null}
            style={previewWidth !== null ? `width: ${previewWidth}px` : ''}
            bind:this={previewPlayerEl}
          >
            <iframe
              bind:this={previewIframeEl}
              src={previewUrl}
              title="Timeline preview"
              class="preview-iframe"
              onload={() => (previewIframeReady = true)}
              allowfullscreen
            ></iframe>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="preview-resize-handle" onpointerdown={startResize} aria-hidden="true"></div>
          </div>
          {#if showSettingsPanel}
            <div class="preview-box__settings" transition:fly={{ x: 240, duration: 180 }}>
              <SettingsPanel
                {settings}
                onchange={onsettingschange}
                onclose={() => (showSettingsPanel = false)}
              />
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- ── Main ──────────────────────────────────────────────────────────────── -->
  <main class="app-main">
    {#if showEventList}
      <div class="eventlist-panel">
        <EventList
          {titleEvent}
          {entries}
          {selectedId}
          panelId="event-editor-panel"
          {deletedItem}
          {deletedItemLeaving}
          onselect={(id) => { onselect(id); showEventList = false; }}
          onadd={() => { onadd(); showEventList = false; }}
          onaddtitle={() => { onaddtitle(); showEventList = false; }}
          ondelete={ondelete}
          onundo={onundo}
        />
      </div>
    {/if}
    <aside class="app-sidebar">
      <EventList
        {titleEvent}
        {entries}
        {selectedId}
        panelId="event-editor-panel"
        {deletedItem}
        {deletedItemLeaving}
        onselect={onselect}
        onadd={onadd}
        onaddtitle={onaddtitle}
        ondelete={ondelete}
        onundo={onundo}
      />
    </aside>

    <div
      class="app-editor"
      id="event-editor-panel"
      role="tabpanel"
      aria-labelledby={selectedId ? `filmstrip-tab-${selectedId}` : undefined}
      tabindex="0"
    >
      {#if selectedEvent !== null}
        {#key selectedId}
          <EventEditor
            event={selectedEvent}
            isTitle={isEditingTitle}
            index={isEditingTitle ? undefined : entries.findIndex(e => e.key === selectedId)}
            takenIds={otherSlideIds}
            onchange={onupdate}
            ondelete={() => selectedId && ondelete(selectedId)}
            {headlineFragment}
            {bodyFragment}
            {historyVersion}
          />
        {/key}
      {:else}
        <div class="editor-empty">
          <div class="editor-empty__inner">
            <p class="intro">Get started by adding slides to your timeline.</p>
            {#if titleEvent === null}
              <button class="button button-secondary" onclick={onaddtitle}>+ Add title slide</button>
            {/if}
            <button class="button button-primary" onclick={onadd}>+ Add first event</button>
          </div>
        </div>
      {/if}
    </div>
  </main>


</div>

<style>
  /* box-sizing and html/body/app height are set in index.html or main.ts, not here */

  .editor-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: 'Apres RE', system-ui, sans-serif;
    background: #f8f8f8;
  }

  /* ── Sub-nav ─────────────────────────────────────────────────── */
  .subnav {
    display: flex;
    align-items: center;
    padding: 0 1.25rem;
    gap: 0.75rem;
    background: #e5e7eb;
    border-bottom: 1px solid #d1d5db;
    min-height: 38px;
  }

  .subnav button { margin-bottom: 0; text-transform: none; font-weight: normal; }

  .btn-back {
    background: transparent;
    border: 1px solid #9ca3af;
    color: #374151;
    padding: 0.2rem 0.6rem;
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
  }
  .btn-back:hover { border-color: #374151; color: #111; }

  .subnav-divider { color: #9ca3af; user-select: none; }

  .subnav-title-btn {
    font-size: 0.85rem;
    color: #374151;
    font-weight: 400;
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
    max-width: 340px;
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    padding: 0.15rem 0.35rem;
    cursor: text;
    font-family: inherit;
    text-align: left;
  }
  .subnav-title-btn:hover { border-color: #9ca3af; background: #fff; }

  .subnav-title-btn { display: flex; align-items: center; gap: 0.25rem; }

  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .title-pencil {
    font-size: 0.9rem;
    opacity: 0.35;
    flex-shrink: 0;
    margin-left: auto;
    display: inline-block;
    transform: scaleX(-1);
  }
  .subnav-title-btn:hover .title-pencil { opacity: 0.65; }

  .subnav-title-input {
    font-size: 0.85rem;
    color: #111;
    font-weight: 400;
    font-family: inherit;
    letter-spacing: 0.02em;
    flex: 1;
    min-width: 0;
    max-width: 340px;
    border: 1px solid #374151;
    border-radius: 2px;
    padding: 0.15rem 0.35rem;
    background: #fff;
    outline: none;
  }

  .warn-back {
    font-size: 0.75rem;
    color: #92400e;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .subnav-actions { margin-left: auto; display: flex; align-items: center; gap: 0.5rem; }
  .subnav-actions button { white-space: nowrap; }

  .subnav-auth { display: flex; align-items: center; }

  /* ── Events button (mobile only) ─────────────────────────────── */
  .btn-events {
    display: none;
    background: #e5e7eb;
    border: 1px solid #9ca3af;
    color: #374151;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    font-family: inherit;
    font-weight: normal;
    text-transform: none;
    cursor: pointer;
    border-radius: 2px;
    margin: 0;
    white-space: nowrap;
  }
  .btn-events:hover { background: #d1d5db; }

  /* ── Event list panel ────────────────────────────────────────── */
  .eventlist-panel {
    background: #fff;
    overflow-y: auto;
  }

  .btn-preview {
    background: #df4e13;
    border: 1px solid #df4e13;
    color: #fff;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    position: relative;
  }
  .btn-preview:hover { background: #c44310; border-color: #c44310; }

  .btn-settings {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    background: #e5e7eb;
    border: 1px solid #9ca3af;
    color: #374151;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
  }
  .btn-settings:hover { background: #d1d5db; }

  .btn-publish {
    background: #24a549;
    border: 1px solid #1f9040;
    color: #fdfffd;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
  }
  .btn-publish:hover:not(:disabled) { background: #1f9040; }
  .btn-publish:disabled { opacity: 0.35; cursor: default; }

  .btn-share {
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
  }
  .btn-share[aria-pressed="true"] { filter: brightness(0.85); }

  .publish-status {
    font-size: 0.78rem;
    color: #15803d;
    white-space: nowrap;
  }

  /* ── Publish drawer ──────────────────────────────────────────── */
  .share-panel {
    background: #1a1c1e;
    border-bottom: 1px solid #2a2c2e;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow-y: auto;
    min-width: 0;
    min-height: 0;
  }

  .share-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: #222426;
    border-radius: 4px;
    border: 1px solid #2e3033;
  }

  .share-section-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .share-section-row > .share-section {
    flex: 1 1 280px;
  }

  .share-section--locked {
    opacity: 0.5;
  }

  .share-section__title {
    font-size: 0.75rem;
    font-weight: 600;
    color: #e5e7eb;
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .share-section__body {
    font-size: 0.78rem;
    color: #9ca3af;
    margin: 0;
    line-height: 1.5;
  }

  .share-section__body strong { color: #d1d5db; font-weight: 600; }

  .share-section__warn {
    font-size: 0.78rem;
    color: #fbbf24;
    margin: 0 0 0.5rem;
    font-weight: 600;
  }

  .share-code-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.25rem;
  }

  .share-code-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6b7280;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .btn-open {
    color: #13a4df;
    font-size: 0.8rem;
    text-decoration: none;
    text-shadow: none;
    flex-shrink: 0;
    padding: 0.1rem 0.2rem;
    border-radius: 2px;
  }
  .btn-open:hover { color: #fff; }

  .share-link {
    color: #13a4df;
    text-shadow: none;
  }
  .share-link:hover { color: #bfdbfe; }
  .share-link:focus { outline: none; }
  .share-link:focus-visible { outline: 2px solid #13a4df; outline-offset: 2px; border-radius: 1px; }

  .share-code {
    font-size: 0.7rem;
    color: #a3e635;
    background: #111;
    padding: 0.2rem 0.4rem;
    border-radius: 2px;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'Courier New', monospace;
  }

  .btn-copy {
    background: transparent;
    border: 1px solid #444;
    color: #888;
    padding: 0.15rem 0.5rem;
    font-size: 0.72rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-copy:hover { border-color: #888; color: #fff; }

  .btn-download {
    align-self: flex-start;
    background: transparent;
    border: 1px solid #4b5563;
    color: #d1d5db;
    padding: 0.2rem 0.6rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    margin-top: auto;
  }
  .btn-download:hover { border-color: #9ca3af; color: #fff; }

  /* ── Main two-column ─────────────────────────────────────────── */
  .app-main {
    display: grid;
    grid-template-columns: 200px minmax(0, 1fr);
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  .app-sidebar {
    background: #fff;
    border-right: 1px solid #e8e8e8;
    overflow-y: auto;
  }

  .app-editor {
    overflow-y: auto;
    overflow-x: hidden;
    min-width: 0;
    background: #fff;
  }

  /* ── Empty state ─────────────────────────────────────────────── */
  .editor-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 2rem;
  }

  .editor-empty__inner {
    text-align: center;
    max-width: 320px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .editor-empty__inner .intro { font-size: 1.1rem; font-weight: 600; color: #1d1f21; margin: 0; }
  .editor-empty__inner p { color: #646464; margin: 0; font-size: 0.9rem; }

  /* ── Preview modal ───────────────────────────────────────────── */
  .preview-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 2rem;
    box-sizing: border-box;
  }

  .preview-box {
    width: min(1200px, 100%);
    height: min(800px, 100%);
    background: #111;
    display: grid;
    grid-template-rows: auto 1fr;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  .preview-box__chrome {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 1rem;
    min-height: 32px;
    background: #1d1f21;
    border-bottom: 2px solid #df4e13;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  /* Orangeline's global button style adds a margin-bottom to every <button>;
     reset it here since these buttons live outside .subnav's own reset. */
  .preview-box__chrome button { margin: 0; }

  .preview-drawer__label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
  }

  .preview-drawer__warn {
    font-size: 0.72rem;
    color: #fbbf24;
  }

  .preview-chrome-right {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  /*
   * The settings toggle and the preview's close button used to sit adjacent,
   * and once the settings panel opened beneath it the close button read as
   * that panel's dismiss control — one mis-click away from losing the whole
   * preview. The panel now carries its own close, and these two are separated
   * and labeled so neither is mistaken for the other.
   */
  .preview-chrome-sep {
    width: 1px;
    align-self: stretch;
    margin: 0 0.4rem;
    background: #3a3a3a;
  }

  .preview-drawer__close {
    background: none;
    border: 1px solid #444;
    color: #9ca3af;
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0.1rem 0.4rem;
    cursor: pointer;
    border-radius: 2px;
    line-height: 1.4;
  }
  .preview-drawer__close:hover { border-color: #9ca3af; color: #fff; }

  .preview-size-presets {
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  .preview-size-btn {
    background: none;
    border: 1px solid #444;
    color: #9ca3af;
    font-size: 0.7rem;
    font-family: inherit;
    padding: 0.15rem 0.45rem;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
  }
  .preview-size-btn:hover { border-color: #9ca3af; color: #fff; }
  .preview-size-btn.active { background: #13a4df; border-color: #13a4df; color: #fff; }

  /* Pill shape, not the presets' rectangle — stays visually distinct from the
     presets regardless of state. Shape never changes between rest/active/hover,
     only color, so toggling it doesn't visually jump. */
  .preview-settings-toggle {
    background: rgba(19, 164, 223, 0.14);
    border: 1px solid #13a4df;
    color: #6dcdf0;
    font-size: 0.7rem;
    font-weight: 600;
    font-family: inherit;
    padding: 0.2rem 0.75rem;
    cursor: pointer;
    border-radius: 999px;
    white-space: nowrap;
    transition: background-color 0.15s ease, color 0.15s ease;
  }
  .preview-settings-toggle:hover { background: rgba(19, 164, 223, 0.28); color: #fff; }
  .preview-settings-toggle.active { background: #13a4df; color: #fff; }

  .preview-box__stage {
    position: relative;
    display: flex;
    overflow: hidden;
    min-height: 0;
  }

  .preview-box__player {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
  }
  .preview-box__player.sized {
    flex: 0 0 auto;
    margin: 0 auto;
  }

  /* Floats on top of the player rather than shrinking it, so opening settings
     doesn't change the width being previewed (defeats device-size testing). */
  .preview-box__settings {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 240px;
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.45);
    z-index: 6;
  }

  .preview-resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    bottom: 0;
    width: 8px;
    cursor: ew-resize;
    z-index: 5;
    touch-action: none;
  }
  .preview-resize-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 2px;
    width: 3px;
    height: 32px;
    margin-top: -16px;
    background: #555;
    border-radius: 2px;
  }
  .preview-resize-handle:hover::after { background: #13a4df; }

  .preview-iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  /* ── Responsive ──────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .editor-shell { height: 100dvh; }

    /* Subnav: back+title on row 1, actions on row 2 */
    .subnav {
      flex-wrap: wrap;
      padding: 0.2rem 0.75rem;
      min-height: unset;
      gap: 0.2rem 0.5rem;
    }

    .subnav-divider { display: none; }

    .subnav-title-btn,
    .subnav-title-input { max-width: none; }

    /* Auth stays in row 1, pushed right */
    .subnav-auth {
      order: 1;
      margin-left: auto;
    }

    /* Actions wrap to row 2 */
    .subnav-actions {
      order: 2;
      margin-left: 0;
      width: 100%;
      border-top: 1px solid #d1d5db;
      padding: 0.2rem 0;
      gap: 0.35rem;
      overflow-x: auto;
    }

    /* Trim button labels so the row stays on one line rather than wrapping */
    .btn-settings__label { display: none; }
    .btn-share__arrow { display: none; }
    .subnav-actions button { padding-left: 0.5rem; padding-right: 0.5rem; }

    /* Hide sidebar — event list lives in the subnav dropdown */
    .app-sidebar { display: none; }
    .app-main { grid-template-columns: 1fr; }

    .btn-events { display: block; }

    /* When publish is open, hide main and let the drawer fill the remaining space */
    .show-share .app-main { display: none; }
    .show-share .share-panel { flex: 1; }

    /* Event list overlays left half of main */
    .app-main { position: relative; }
    .eventlist-panel {
      position: absolute;
      left: 0;
      top: 0;
      width: 50%;
      height: 100%;
      border-right: 1px solid #e8e8e8;
      box-shadow: 4px 0 12px rgba(0, 0, 0, 0.12);
      z-index: 5;
    }

    /* Fix Orangeline uppercase on empty-state buttons */
    .editor-empty__inner .button {
      text-transform: none;
      margin: 0;
      width: 100%;
    }

    /* Preview: device presets/drag handle are meaningless on an already
       phone-width editor — hide them and stack the settings panel instead
       of squeezing the player into a sliver. */
    .preview-backdrop { padding: 0; }
    .preview-box { border-radius: 0; }
    .preview-size-presets { display: none; }
    .preview-resize-handle { display: none; }
    .preview-box__player.sized { width: auto !important; }

    /* A floating panel would cover almost the whole phone-width preview, so
       put it back in normal flow, stacked below the player. */
    .preview-box__stage.settings-open {
      flex-direction: column;
    }
    .preview-box__settings {
      position: static;
      width: auto;
      box-shadow: none;
      flex: 0 0 auto;
      max-height: 45%;
    }
  }
</style>
