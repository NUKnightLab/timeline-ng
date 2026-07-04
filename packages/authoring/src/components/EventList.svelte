<script lang="ts">
  import type { TLEvent } from '@knight-lab/timeline-ng-core';
  import { resolveBackgroundImageUrl } from '@knight-lab/timeline-ng-core';

  interface DeletedItem {
    event: TLEvent;
    isTitle: boolean;
    sortedIndex: number;
  }

  interface Props {
    titleEvent: TLEvent | null;
    events: TLEvent[];
    selectedId: string | null;
    panelId?: string;
    deletedItem: DeletedItem | null;
    deletedItemLeaving: boolean;
    onselect: (id: string) => void;
    onadd: () => void;
    onaddtitle: () => void;
    ondelete: (id: string) => void;
    onundo: () => void;
  }

  let { titleEvent, events, selectedId, panelId = 'event-editor-panel', deletedItem, deletedItemLeaving, onselect, onadd, onaddtitle, ondelete, onundo }: Props = $props();
  let filmstripScrollEl: HTMLDivElement | null = null;
  let resolvedBackgrounds = $state<Record<string, string | null>>({});
  const pendingBackgrounds = new Set<string>();

  type DisplayItem = { type: 'event'; event: TLEvent } | { type: 'undo'; event: TLEvent };

  const displayEvents = $derived.by((): DisplayItem[] => {
    const items: DisplayItem[] = events.map(e => ({ type: 'event', event: e }));
    if (deletedItem && !deletedItem.isTitle) {
      const idx = Math.min(deletedItem.sortedIndex, items.length);
      items.splice(idx, 0, { type: 'undo', event: deletedItem.event });
    }
    return items;
  });

  function label(event: TLEvent): string {
    const raw = event.text?.headline ?? '';
    const stripped = raw.replace(/<[^>]+>/g, '').trim();
    return stripped || '';
  }

  function dateStr(event: TLEvent): string {
    const sd = event.start_date;
    if (!sd) return '';
    const parts: string[] = [String(sd.year)];
    if (sd.month) parts.push(String(sd.month).padStart(2, '0'));
    if (sd.day) parts.push(String(sd.day).padStart(2, '0'));
    return parts.join('\u2011');
  }

  function isDarkColor(hex: string): boolean {
    const h = hex.replace('#', '');
    if (h.length !== 6) return false;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.35;
  }

  function backgroundKey(id: string, url: string): string {
    return `${id}::${url}`;
  }

  function backgroundSrc(id: string, event: TLEvent): string | null {
    const url = event.background?.url?.trim();
    if (!url) return null;
    return resolvedBackgrounds[backgroundKey(id, url)] ?? null;
  }

  function thumbDark(event: TLEvent, defaultColor: string, bgSrc: string | null): boolean {
    return !!bgSrc || isDarkColor(event.background?.color ?? defaultColor);
  }

  const VALID_ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

  function validationErrors(event: TLEvent, isTitle: boolean): string[] {
    const errs: string[] = [];
    if (!isTitle && !event.start_date) errs.push('No start date');
    if (event.unique_id && !VALID_ID.test(event.unique_id)) errs.push('Invalid slide ID');
    return errs;
  }

  function handleDeleteKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      ondelete(id);
    }
  }

  const navigableIds = $derived.by((): string[] => {
    const ids: string[] = [];
    if (titleEvent) ids.push('title');
    for (const item of displayEvents) {
      if (item.type === 'event' && item.event.unique_id) ids.push(item.event.unique_id);
    }
    return ids;
  });

  const activeId = $derived.by(() => {
    if (selectedId && navigableIds.includes(selectedId)) return selectedId;
    return navigableIds[0] ?? null;
  });

  function focusSlide(id: string) {
    const target = filmstripScrollEl?.querySelector<HTMLElement>(`[data-slide-id="${id}"]`);
    target?.focus();
  }

  function moveSelection(currentId: string, direction: -1 | 1) {
    const index = navigableIds.indexOf(currentId);
    if (index === -1) return;
    const nextId = navigableIds[index + direction];
    if (!nextId) return;
    onselect(nextId);
    queueMicrotask(() => focusSlide(nextId));
  }

  function handleNavigationKey(e: KeyboardEvent, id: string) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(id, -1);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(id, 1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      const firstId = navigableIds[0];
      if (!firstId) return;
      onselect(firstId);
      queueMicrotask(() => focusSlide(firstId));
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const lastId = navigableIds[navigableIds.length - 1];
      if (!lastId) return;
      onselect(lastId);
      queueMicrotask(() => focusSlide(lastId));
    }
  }

  $effect(() => {
    const requests: Array<{ id: string; url: string }> = [];
    if (titleEvent?.background?.url?.trim()) {
      requests.push({ id: 'title', url: titleEvent.background.url.trim() });
    }
    for (const item of displayEvents) {
      if (item.type !== 'event' || !item.event.unique_id) continue;
      const url = item.event.background?.url?.trim();
      if (url) requests.push({ id: item.event.unique_id, url });
    }

    for (const { id, url } of requests) {
      const key = backgroundKey(id, url);
      if (key in resolvedBackgrounds || pendingBackgrounds.has(key)) continue;
      pendingBackgrounds.add(key);
      void resolveBackgroundImageUrl({ url }).then((src) => {
        resolvedBackgrounds = { ...resolvedBackgrounds, [key]: src };
        pendingBackgrounds.delete(key);
      });
    }
  });
</script>

<nav class="filmstrip" aria-label="Timeline events">
  <div class="filmstrip__header">
    <button class="add-btn" onclick={onadd}>+ Add event</button>
  </div>
<div class="filmstrip__scroll" bind:this={filmstripScrollEl} role="tablist" aria-orientation="vertical">

  <!-- Title slide -->
  {#if titleEvent}
    {@const titleBgSrc = backgroundSrc('title', titleEvent)}
    {@const titleErrors = validationErrors(titleEvent, true)}
    <div class="slide-entry">
      <button
        type="button"
        class="slide-card slide-card--title"
        class:slide-card--active={selectedId === 'title'}
        role="tab"
        id="filmstrip-tab-title"
        aria-selected={selectedId === 'title'}
        aria-controls={panelId}
        tabindex={activeId === 'title' ? 0 : -1}
        data-slide-id="title"
        onclick={() => onselect('title')}
        onkeydown={(e) => {
          handleNavigationKey(e, 'title');
          handleDeleteKey(e, 'title');
        }}
      >
        <div class="slide-num">
          T
          {#if titleErrors.length > 0}
            <span class="slide-num__error" title={titleErrors.join(' · ')}>!</span>
          {/if}
        </div>
        <div class="slide-thumb"
          class:slide-thumb--dark={thumbDark(titleEvent, '#1d1f21', titleBgSrc)}
          style:background-color={titleEvent.background?.color ?? '#1d1f21'}
          style:background-image={titleBgSrc ? `url(${titleBgSrc})` : undefined}
        >
          {#if titleEvent.media?.thumbnail}
            <img class="slide-thumb__img" src={titleEvent.media.thumbnail} alt="" />
          {/if}
          {#if titleBgSrc}
            <div class="slide-thumb__scrim"></div>
          {/if}
          <div class="slide-thumb__text">
            <span class="slide-thumb__headline">{label(titleEvent) || '(untitled)'}</span>
          </div>
        </div>
      </button>
      <button
        type="button"
        class="slide-thumb__delete"
        aria-label="Remove title slide"
        onclick={() => ondelete('title')}
      >×</button>
    </div>
  {:else if deletedItem?.isTitle}
    <div class="slide-card slide-card--deleted" class:slide-card--leaving={deletedItemLeaving}>
      <div class="slide-num">T</div>
      <div class="slide-thumb" style="background:#df4e13;">
        <button class="undo-btn" onclick={onundo}>
          <span class="slide-undo-name">{label(deletedItem.event) || '(untitled)'}</span>
          <span class="slide-undo-label">Undo delete</span>
        </button>
      </div>
    </div>
  {:else}
    <button class="add-title-btn" onclick={onaddtitle}>+ Add title slide</button>
  {/if}

  <!-- Divider -->
  <div class="filmstrip__divider" role="separator"></div>

  <!-- Events -->
  {#each displayEvents as item, i (item.type === 'event' ? item.event.unique_id : '__undo__')}
    {#if item.type === 'undo'}
      <div class="slide-card slide-card--deleted" class:slide-card--leaving={deletedItemLeaving}>
        <div class="slide-num">—</div>
        <div class="slide-thumb" style="background:#df4e13;">
          <button class="undo-btn" onclick={onundo}>
            <span class="slide-undo-name">{label(item.event) || '(untitled)'}</span>
            <span class="slide-undo-label">Undo delete</span>
          </button>
        </div>
      </div>
    {:else}
      {@const event = item.event}
      {@const id = event.unique_id!}
      {@const eventBgSrc = backgroundSrc(id, event)}
      {@const evErrors = validationErrors(event, false)}
      <div class="slide-entry">
        <button
          type="button"
          class="slide-card"
          class:slide-card--active={selectedId === id}
          class:slide-card--invalid={!event.start_date}
          role="tab"
          id={"filmstrip-tab-" + id}
          aria-selected={selectedId === id}
          aria-controls={panelId}
          tabindex={activeId === id ? 0 : -1}
          data-slide-id={id}
          onclick={() => onselect(id)}
          onkeydown={(e) => {
            handleNavigationKey(e, id);
            handleDeleteKey(e, id);
          }}
        >
          <div class="slide-num" class:slide-num--has-error={evErrors.length > 0}>
            {i + 1}
            {#if evErrors.length > 0}
              <span class="slide-num__error" title={evErrors.join(' · ')}>!</span>
            {/if}
          </div>
          <div class="slide-thumb"
            class:slide-thumb--dark={thumbDark(event, '#f0ede8', eventBgSrc)}
            style:background-color={event.background?.color ?? '#f0ede8'}
            style:background-image={eventBgSrc ? `url(${eventBgSrc})` : undefined}
          >
            {#if event.media?.thumbnail}
              <img class="slide-thumb__img" src={event.media.thumbnail} alt="" />
            {/if}
            {#if eventBgSrc}
              <div class="slide-thumb__scrim"></div>
            {/if}
            {#if !event.start_date}
              <div class="slide-thumb__nodate" title="No date — required">⚠ No date</div>
            {/if}
            <div class="slide-thumb__text">
              {#if dateStr(event)}
                <span class="slide-thumb__date">{dateStr(event)}</span>
              {/if}
              <span class="slide-thumb__headline">{label(event) || '(untitled)'}</span>
            </div>
          </div>
        </button>
        <button
          type="button"
          class="slide-thumb__delete"
          aria-label="Delete event"
          onclick={() => ondelete(id)}
        >×</button>
      </div>
    {/if}
  {/each}

  {#if displayEvents.length === 0}
    <p class="filmstrip__empty">No events yet.</p>
  {/if}

</div><!-- end filmstrip__scroll -->
</nav>

<style>
  .filmstrip {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .filmstrip__scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 0.5rem 0 0.25rem;
    gap: 2px;
    min-height: 0;
  }

  .filmstrip__header {
    border-bottom: 1px solid #ececec;
    padding: 0.5rem 8px 0.5rem 30px;
    flex-shrink: 0;
  }

  .slide-entry {
    position: relative;
  }

  /* ── Slide cards ───────────────────────────────────────────────── */
  .slide-card {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 8px 4px 4px;
    cursor: pointer;
    border: none;
    background: none;
    text-align: left;
    width: 100%;
    border-radius: 3px;
    outline-offset: -2px;
  }

  .slide-card:hover { background: #f5f5f5; }
  .slide-card--active { background: #fff4f0; }
  .slide-card:focus-visible { outline: 2px solid #df4e13; }

  /* ── Slide number ──────────────────────────────────────────────── */
  .slide-num {
    width: 20px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    font-size: 0.7rem;
    color: #aaa;
    font-feature-settings: "tnum";
    padding-top: 5px;
    line-height: 1;
  }
  .slide-card--active .slide-num { color: #df4e13; font-weight: 700; }
  .slide-num--has-error { color: #c0392b; }
  .slide-num__error {
    font-size: 0.62rem;
    font-weight: 700;
    color: #c0392b;
    line-height: 1;
    cursor: default;
  }

  /* ── Thumbnail ─────────────────────────────────────────────────── */
  .slide-thumb {
    flex: 1;
    aspect-ratio: 16 / 9;
    border-radius: 3px;
    border: 2px solid transparent;
    position: relative;
    overflow: hidden;
    background-size: cover;
    background-position: center;
    transition: border-color 0.1s;
    min-width: 0;
  }

  .slide-card--active .slide-thumb { border-color: #df4e13; }
  .slide-card:not(.slide-card--active):hover .slide-thumb { border-color: #ddd; }

  .slide-thumb__img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0.35;
  }

  .slide-thumb__scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.38);
    z-index: 0;
  }

  .slide-thumb__text {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    padding: 4px 6px;
    gap: 2px;
    z-index: 1;
  }

  .slide-thumb__date {
    font-size: 0.55rem;
    font-feature-settings: "tnum";
    line-height: 1;
    color: rgba(0, 0, 0, 0.45);
  }

  .slide-thumb--dark .slide-thumb__date {
    color: rgba(255, 255, 255, 0.75);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }

  .slide-thumb__headline {
    font-size: 0.6rem;
    line-height: 1.2;
    font-weight: 600;
    color: #1d1f21;
    line-clamp: 3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .slide-thumb--dark .slide-thumb__headline {
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }

  /* ── No-date warning ──────────────────────────────────────────── */
  .slide-thumb__nodate {
    position: absolute;
    top: 3px;
    right: 3px;
    font-size: 0.5rem;
    font-weight: 700;
    color: #fff;
    background: rgba(192, 57, 43, 0.85);
    border-radius: 2px;
    padding: 1px 3px;
    letter-spacing: 0.04em;
    z-index: 2;
  }

  /* ── Delete button ─────────────────────────────────────────────── */
  .slide-thumb__delete {
    position: absolute;
    top: 6px;
    right: 10px;
    background: rgba(0,0,0,0.45);
    border: none;
    color: #fff;
    font-size: 0.75rem;
    line-height: 1;
    width: 16px;
    height: 16px;
    border-radius: 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.1s;
    padding: 0;
    z-index: 2;
  }

  .slide-entry:hover .slide-thumb__delete,
  .slide-entry:focus-within .slide-thumb__delete,
  .slide-card--active + .slide-thumb__delete { opacity: 1; }
  .slide-thumb__delete:hover { background: #c0392b; }

  /* ── Undo placeholder ─────────────────────────────────────────── */
  @keyframes undoIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  @keyframes undoOut {
    from { opacity: 1; max-height: 200px; padding-top: 4px; padding-bottom: 4px; }
    to   { opacity: 0; max-height: 0;     padding-top: 0;   padding-bottom: 0; }
  }

  .slide-card--deleted {
    cursor: default;
    animation: undoIn 0.18s ease forwards;
  }
  .slide-card--deleted .slide-thumb {
    border: none;
    display: block;
    padding: 0;
  }
  .slide-card--deleted:hover { background: none; }
  .slide-card--leaving {
    animation: undoOut 0.35s ease forwards;
    overflow: hidden;
  }

  .undo-btn {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    border-radius: inherit;
    color: #fff;
    font-family: inherit;
    cursor: pointer;
    padding: 4px;
    transition: background 0.1s;
    min-width: 0;
  }
  .undo-btn:hover { background: rgba(0,0,0,0.15); }

  .slide-undo-name {
    font-size: 0.55rem;
    opacity: 0.8;
    text-align: center;
    overflow: hidden;
    line-clamp: 2;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .slide-undo-label {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
  }

  /* ── Misc ──────────────────────────────────────────────────────── */
  .filmstrip__divider {
    height: 1px;
    background: #ececec;
    margin: 4px 8px;
  }

  .filmstrip__empty {
    font-size: 0.8rem;
    color: #b8b8b8;
    padding: 0.25rem 0.75rem;
    margin: 0;
    font-style: italic;
  }

  .add-title-btn {
    background: none;
    border: 1px dashed #d4d4d4;
    border-radius: 3px;
    color: #888;
    font-size: 0.75rem;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    margin: 2px 8px 2px 30px;
    text-align: left;
    transition: border-color 0.15s, color 0.15s;
  }
  .add-title-btn:hover { border-color: #df4e13; color: #df4e13; }

  .add-btn {
    background: none;
    border: 1px dashed #d4d4d4;
    border-radius: 3px;
    color: #888;
    font-size: 0.75rem;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: border-color 0.15s, color 0.15s;
  }
  .add-btn:hover { border-color: #df4e13; color: #df4e13; }
</style>
