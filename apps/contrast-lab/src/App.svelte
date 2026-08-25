<script lang="ts">
  import { SlidePlayer } from '@knight-lab/timeline-ng';
  import '@knight-lab/timeline-ng/styles.css';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';
  import timelineData from './timeline.json';
  import { audit, type Row } from './audit';

  const timeline = timelineData as TLTimeline;

  type Nav = 'full' | 'quiet' | 'minimal';
  const SKINS: Nav[] = ['full', 'quiet', 'minimal'];

  let mode = $state<'compare' | 'toggle'>('compare');
  let theme = $state<'light' | 'dark' | 'auto'>('light');
  let solo = $state<Nav>('quiet');
  /* Which two nav levels face off in compare mode. */
  let left = $state<Nav>('full');
  let right = $state<Nav>('quiet');
  /* Contrast is a separate axis, so it applies to both panels at once. */
  let highContrast = $state(false);
  /*
   * Kept in sync across both players so the comparison is like-for-like.
   * Starts at 1 rather than the title slide, which has no date line and no
   * active nav marker — several audit rows would simply be missing there.
   */
  let slideIndex = $state(1);

  let frames = $state<Record<string, HTMLElement | undefined>>({});
  let reports = $state<Record<string, Row[]>>({});

  const shown: Nav[] = $derived(mode === 'compare' ? [left, right] : [solo]);

  /*
   * Re-audit whenever anything that could move a colour changes. Reading is
   * deferred a frame so the browser has recalculated style after the attribute
   * flip, and colour transitions on nav labels have settled.
   */
  $effect(() => {
    void [mode, theme, solo, left, right, highContrast, slideIndex];
    const t = setTimeout(() => {
      const next: Record<string, Row[]> = {};
      for (const skin of shown) {
        const el = frames[skin];
        if (el) next[skin] = audit(el);
      }
      reports = next;
    }, 400);
    return () => clearTimeout(t);
  });

  const failCount = (rows: Row[] | undefined) =>
    rows ? rows.filter(r => r.required > 0 && !Number.isNaN(r.ratio) && r.ratio < r.required).length : 0;
</script>

<div class="lab" data-lab-theme={theme === 'auto' ? undefined : theme}>
  <header class="bar">
    <h1>Contrast Lab</h1>

    <div class="group" role="group" aria-label="View">
      <button class:on={mode === 'compare'} onclick={() => (mode = 'compare')}>Side by side</button>
      <button class:on={mode === 'toggle'} onclick={() => (mode = 'toggle')}>Toggle</button>
    </div>

    {#if mode === 'toggle'}
      <div class="group" role="group" aria-label="Skin">
        {#each SKINS as s}
          <button class:on={solo === s} onclick={() => (solo = s)}>{s}</button>
        {/each}
      </div>
    {:else}
      <div class="pair">
        <label>A <select bind:value={left}>{#each SKINS as s}<option value={s}>{s}</option>{/each}</select></label>
        <label>B <select bind:value={right}>{#each SKINS as s}<option value={s}>{s}</option>{/each}</select></label>
      </div>
    {/if}

    <div class="group" role="group" aria-label="Contrast">
      <button class:on={!highContrast} onclick={() => (highContrast = false)}>Normal</button>
      <button class:on={highContrast} onclick={() => (highContrast = true)}>AAA</button>
    </div>

    <div class="group" role="group" aria-label="Theme">
      {#each ['light', 'dark', 'auto'] as const as t}
        <button class:on={theme === t} onclick={() => (theme = t)}>{t}</button>
      {/each}
    </div>

    <label class="slide-pick">
      Slide
      <input type="range" min="0" max={timeline.events.length} bind:value={slideIndex} />
      <span class="count">{slideIndex + 1} / {timeline.events.length + 1}</span>
    </label>
  </header>

  <main class="stage" class:stage--split={shown.length > 1}>
    {#each shown as skin, slot (slot + ':' + skin)}
      <section class="panel">
        <h2 class="panel__title">
          nav: {skin}
          {#if reports[skin]}
            <span class="badge" class:badge--fail={failCount(reports[skin]) > 0}>
              {failCount(reports[skin]) === 0
                ? 'AA clear'
                : `${failCount(reports[skin])} below AA`}
            </span>
          {/if}
        </h2>
        <div class="frame" bind:this={frames[skin]}>
          <SlidePlayer {timeline} {theme} navChrome={skin} {highContrast} initialIndex={slideIndex} />
        </div>
      </section>
    {/each}
  </main>

  <section class="audit">
    <h2 class="audit__title">Measured contrast</h2>
    <p class="audit__note">
      Foreground and background are read from the rendered elements, not from the
      stylesheet — partially transparent marks are composited against whatever is
      actually behind them first. Text needs 4.5:1; marks that carry meaning need
      3:1; purely decorative marks have no threshold. A row only appears when the
      slide actually contains that element, so the set varies as you move the
      slider — a slide with no date, or an event with no duration, drops its row.
      <strong>Resting states only</strong>: hover and focus are not measured, because
      forcing them would mean re-implementing the cascade here, where it could
      drift from the stylesheet it is supposed to be checking. An active nav
      label once dropped from 17.4:1 to 1.73:1 on hover without this table
      noticing.
    </p>
    <div class="audit__tables" class:audit__tables--split={shown.length > 1}>
      {#each shown as skin, slot (slot + ':' + skin)}
        <table>
          <caption>nav: {skin}{highContrast ? ' + AAA' : ''}</caption>
          <thead>
            <tr><th>element</th><th>fg</th><th>bg</th><th>ratio</th><th>needs</th><th></th></tr>
          </thead>
          <tbody>
            {#each reports[skin] ?? [] as r}
              <tr class:fail={r.required > 0 && !Number.isNaN(r.ratio) && r.ratio < r.required}>
                <td>{r.label}</td>
                <td>
                  {#if !Number.isNaN(r.ratio)}<span class="sw" style="background:{r.fg}"></span>{/if}{r.fgHex}
                </td>
                <td><span class="sw" style="background:{r.bg}"></span>{r.bgHex}</td>
                <td class="num">{Number.isNaN(r.ratio) ? '—' : r.ratio.toFixed(2)}</td>
                <td class="num">{r.required > 0 ? r.required.toFixed(1) : '—'}</td>
                <td>
                  {#if Number.isNaN(r.ratio)}<span class="muted">painted out</span>
                  {:else if r.required === 0}<span class="muted">decorative</span>
                  {:else if r.ratio >= r.required}pass
                  {:else}<strong>FAIL</strong>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/each}
    </div>
  </section>
</div>

<style>
  :global(html, body, #app) { margin: 0; padding: 0; height: 100%; }
  :global(body) { background: #fbfbfb; color: #1a1a1a; }

  .lab {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    font: 14px/1.5 system-ui, sans-serif;
  }
  .lab[data-lab-theme='dark'] { background: #101010; color: #ededed; }

  .bar {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex-wrap: wrap;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid currentColor;
    border-color: color-mix(in srgb, currentColor 15%, transparent);
  }
  .bar h1 { margin: 0; font-size: 1rem; font-weight: 700; letter-spacing: 0.02em; }

  .group { display: flex; }
  .group button {
    font: inherit;
    padding: 0.3rem 0.7rem;
    background: transparent;
    color: inherit;
    border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
    cursor: pointer;
    text-transform: capitalize;
  }
  .group button + button { border-left: none; }
  .group button:first-child { border-radius: 4px 0 0 4px; }
  .group button:last-child { border-radius: 0 4px 4px 0; }
  .group button.on { background: currentColor; }
  .group button.on::after { content: ''; }
  .lab .group button.on { background: #1a1a1a; color: #fff; }
  .lab[data-lab-theme='dark'] .group button.on { background: #ededed; color: #101010; }

  .pair { display: flex; gap: 0.75rem; align-items: center; }
  .pair label { display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; }
  .pair select { font: inherit; padding: 0.25rem; background: transparent; color: inherit;
                 border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 4px; }

  .slide-pick { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; }
  .count { font-variant-numeric: tabular-nums; opacity: 0.7; }

  .stage { display: grid; grid-template-columns: 1fr; gap: 1rem; padding: 1rem; }
  .stage--split { grid-template-columns: 1fr 1fr; }
  @media (max-width: 900px) { .stage--split { grid-template-columns: 1fr; } }

  .panel { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
  .panel__title {
    margin: 0;
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .badge {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    font-size: 0.75rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: #d9f0dd;
    color: #14532d;
  }
  .badge--fail { background: #fbdcdc; color: #7f1d1d; }

  /* Fixed height so both players are measured under identical conditions. */
  .frame {
    height: 460px;
    border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    border-radius: 6px;
    overflow: hidden;
  }

  .audit { padding: 0 1rem 2rem; }
  .audit__title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 0.4rem; }
  .audit__note { margin: 0 0 0.8rem; max-width: 70ch; opacity: 0.75; font-size: 0.85rem; }
  .audit__tables { display: grid; grid-template-columns: 1fr; gap: 1rem; }
  .audit__tables--split { grid-template-columns: 1fr 1fr; }
  @media (max-width: 900px) { .audit__tables--split { grid-template-columns: 1fr; } }

  table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  caption { text-align: left; font-weight: 700; padding-bottom: 0.3rem; text-transform: capitalize; }
  th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); white-space: nowrap; }
  th { font-weight: 600; opacity: 0.7; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  tr.fail { background: color-mix(in srgb, #dc2626 12%, transparent); }
  .muted { opacity: 0.55; }
  .sw {
    display: inline-block;
    width: 0.7rem;
    height: 0.7rem;
    border-radius: 2px;
    margin-right: 0.35rem;
    vertical-align: -1px;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  }
</style>
