<script lang="ts">
  import { FONT_PAIRINGS, DEFAULT_PAIRING, getPairing, coversLanguage } from '@knight-lab/timeline-ng-core';
  import type { TLSettings, FontPairingId } from '@knight-lab/timeline-ng-core';

  interface Props {
    settings: TLSettings;
    onchange: (patch: Partial<TLSettings>) => void;
    /** Dismiss the panel. Given its own control so the preview's close button
        isn't the nearest thing to reach for. */
    onclose?: () => void;
  }

  let { settings, onchange, onclose }: Props = $props();

  const language = $derived(settings.language ?? 'en');
  const theme = $derived(settings.theme ?? 'auto');
  const reverseOrder = $derived(settings.reverseOrder ?? false);
  const fontPairing = $derived(settings.fontPairing ?? DEFAULT_PAIRING);
  const navChrome = $derived(settings.navChrome ?? 'full');
  const highContrast = $derived(settings.highContrast ?? false);

  const NAV_CHOICES = [
    { id: 'full' as const, label: 'Full', hint: 'Zoom controls, date axis and position bar.' },
    { id: 'quiet' as const, label: 'Quiet', hint: 'Same controls, drawn more lightly.' },
    { id: 'minimal' as const, label: 'Minimal', hint: 'Just the track, markers and labels.' },
  ];

  /*
   * Most of these pairings are Latin, sometimes Cyrillic. A timeline in a
   * script the faces don't cover still renders — from the fallback stack,
   * per character — but it won't look like what the author picked, and
   * finding that out after publishing is the bad version of this.
   */
  const coverageWarning = $derived.by(() => {
    const pairing = getPairing(fontPairing);
    if (!pairing || coversLanguage(pairing, language)) return null;
    return `${pairing.label} doesn't include glyphs for this timeline's language. Text will fall back to a system font.`;
  });

  /* System-font pairings load nothing and cover every script — worth saying. */
  const sortedPairings = $derived(
    [...FONT_PAIRINGS].sort((a, b) => {
      const sys = (p: typeof a) => (p.webfonts.length === 0 ? 0 : 1);
      return sys(a) - sys(b) || a.label.localeCompare(b.label);
    }),
  );
</script>

<div class="settings-panel">
  <div class="settings-panel__header">
    <h3 class="settings-panel__title">Timeline settings</h3>
    {#if onclose}
      <button type="button" class="settings-panel__close" onclick={onclose} aria-label="Close settings">✕</button>
    {/if}
  </div>

  <div class="field">
    <label class="field-label" for="settings-language">Language</label>
    <select
      id="settings-language"
      value={language}
      onchange={(e) => onchange({ language: (e.target as HTMLSelectElement).value })}
    >
      <option value="en">English</option>
      <option value="es">Español</option>
    </select>
  </div>

  <div class="field">
    <label class="field-label" for="settings-font">Typeface</label>
    <select
      id="settings-font"
      value={fontPairing}
      onchange={(e) => onchange({ fontPairing: (e.target as HTMLSelectElement).value as FontPairingId })}
    >
      {#each sortedPairings as p (p.id)}
        <option value={p.id}>
          {p.label}{p.webfonts.length === 0 ? ' — system' : ''}
        </option>
      {/each}
    </select>
    {#if coverageWarning}
      <p class="field-warning" role="status">{coverageWarning}</p>
    {:else}
      <p class="field-hint">Headline and body faces, carried over from the classic TimelineJS.</p>
    {/if}
  </div>

  <div class="field" role="group" aria-label="Theme">
    <span class="field-label">Theme</span>
    <div class="settings-tabs">
      <button type="button" class="settings-tab-btn" class:active={theme === 'light'} onclick={() => onchange({ theme: 'light' })}>Light</button>
      <button type="button" class="settings-tab-btn" class:active={theme === 'dark'} onclick={() => onchange({ theme: 'dark' })}>Dark</button>
      <button type="button" class="settings-tab-btn" class:active={theme === 'auto'} onclick={() => onchange({ theme: 'auto' })}>Auto</button>
    </div>
  </div>

  <div class="field" role="group" aria-label="Timeline navigator">
    <span class="field-label">Navigator</span>
    <div class="settings-tabs">
      {#each NAV_CHOICES as c}
        <button type="button" class="settings-tab-btn" class:active={navChrome === c.id}
                onclick={() => onchange({ navChrome: c.id })}>{c.label}</button>
      {/each}
    </div>
    <p class="field-hint">{NAV_CHOICES.find((c) => c.id === navChrome)?.hint}</p>
  </div>

  <div class="field field-checkbox">
    <label class="field-checkbox-label">
      <input
        type="checkbox"
        checked={highContrast}
        onchange={(e) => onchange({ highContrast: (e.target as HTMLInputElement).checked })}
      />
      High contrast
    </label>
    <p class="field-hint">Raises text and markers to the strictest contrast level (WCAG AAA).</p>
  </div>

  <div class="field field-checkbox">
    <label class="field-checkbox-label">
      <input
        type="checkbox"
        checked={reverseOrder}
        onchange={(e) => onchange({ reverseOrder: (e.target as HTMLInputElement).checked })}
      />
      Reverse order (newest first)
    </label>
    <p class="field-hint">The title slide, if any, always stays first.</p>
  </div>
</div>

<style>
  .field-warning {
    margin: 0.35rem 0 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: #f0b429;
  }

  .settings-panel {
    height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
    padding: 1rem;
    background: #1a1a1a;
    border-left: 1px solid #333;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .settings-panel__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  /* Sized past the 24x24 minimum target, since it sits near the preview's own
     close button and a mis-click costs the whole preview. */
  .settings-panel__close {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    background: none;
    border: 1px solid #444;
    border-radius: 2px;
    color: #9ca3af;
    font-family: inherit;
    font-size: 0.7rem;
    line-height: 1;
    cursor: pointer;
  }

  .settings-panel__close:hover {
    color: #e5e7eb;
    border-color: #666;
  }

  .settings-panel__title {
    margin: 0;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 0;
    margin: 0;
    padding: 0;
    min-width: 0;
  }

  .field-label {
    font-size: 0.78rem;
    font-weight: 600;
    color: #d1d5db;
    margin-bottom: 0.35rem;
  }

  .field-hint {
    margin: 0.35rem 0 0;
    font-size: 0.72rem;
    color: #737373;
    line-height: 1.4;
  }

  .field select {
    background: #222;
    border: 1px solid #444;
    border-radius: 4px;
    color: #eee;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    font-family: inherit;
  }

  .field select:focus {
    outline: none;
    border-color: #13a4df;
    box-shadow: 0 0 0 2px rgba(19, 164, 223, 0.25);
  }

  .settings-tabs {
    display: inline-flex;
    border: 1px solid #444;
    border-radius: 4px;
    overflow: hidden;
    align-self: flex-start;
  }

  .settings-tab-btn {
    margin: 0;
    padding: 0.3rem 0.65rem;
    background: #222;
    border: none;
    border-right: 1px solid #444;
    color: #9ca3af;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
  }
  .settings-tab-btn:last-child { border-right: none; }
  .settings-tab-btn:hover { color: #eee; }
  .settings-tab-btn.active { background: #13a4df; color: #fff; }

  .field-checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    color: #d1d5db;
    cursor: pointer;
  }

  .field-checkbox-label input[type="checkbox"] {
    accent-color: #13a4df;
    width: 0.95rem;
    height: 0.95rem;
  }
</style>
