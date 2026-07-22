<script lang="ts">
  import { SlidePlayer } from '@knight-lab/timeline-ng';
  import '@knight-lab/timeline-ng/styles.css';
  import './theme.css';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';
  import en from './timelines/en.json';
  import es from './timelines/es.json';

  const timelines: Record<string, TLTimeline> = {
    en: en as TLTimeline,
    es: es as TLTimeline,
  };

  let language = $state<'en' | 'es'>('en');
  let theme = $state<'light' | 'dark'>('light');

  const timeline = $derived(timelines[language]);

  function toggleTheme() {
    theme = theme === 'light' ? 'dark' : 'light';
  }
</script>

<div class="zine-theme" data-tl-theme={theme}>
  <header class="masthead">
    <h1 class="masthead__title">Ink &amp; Type</h1>
    <div class="masthead__controls">
      <label class="masthead__field">
        <span class="sr-only">Language</span>
        <select bind:value={language}>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
      </label>
      <button type="button" class="masthead__toggle" onclick={toggleTheme}>
        {theme === 'light' ? '☾ Night edition' : '☀ Day edition'}
      </button>
    </div>
  </header>
  <div class="stage">
    <SlidePlayer {timeline} {language} {theme} />
  </div>
</div>

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    height: 100%;
  }

  .zine-theme {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--tl-color-bg);
    color: var(--tl-color-text);
  }

  .masthead {
    flex: 0 0 auto;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1.5rem;
    border-bottom: 3px solid var(--tl-color-text);
    font-family: var(--tl-font-heading);
  }

  .masthead__title {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .masthead__controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: var(--tl-font-body);
    font-size: 0.85rem;
  }

  .masthead__controls select,
  .masthead__toggle {
    font: inherit;
    color: var(--tl-color-text);
    background: var(--tl-color-surface);
    border: 1px solid var(--tl-color-border);
    padding: 0.35rem 0.6rem;
    cursor: pointer;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }

  .stage {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
