<script lang="ts">
  import type { TLSettings } from '@knight-lab/timeline-ng-core';

  interface Props {
    settings: TLSettings;
    onchange: (patch: Partial<TLSettings>) => void;
  }

  let { settings, onchange }: Props = $props();

  const language = $derived(settings.language ?? 'en');
  const theme = $derived(settings.theme ?? 'auto');
  const reverseOrder = $derived(settings.reverseOrder ?? false);
</script>

<div class="settings-panel">
  <h3 class="settings-panel__title">Timeline settings</h3>

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

  <div class="field" role="group" aria-label="Theme">
    <span class="field-label">Theme</span>
    <div class="settings-tabs">
      <button type="button" class="settings-tab-btn" class:active={theme === 'light'} onclick={() => onchange({ theme: 'light' })}>Light</button>
      <button type="button" class="settings-tab-btn" class:active={theme === 'dark'} onclick={() => onchange({ theme: 'dark' })}>Dark</button>
      <button type="button" class="settings-tab-btn" class:active={theme === 'auto'} onclick={() => onchange({ theme: 'auto' })}>Auto</button>
    </div>
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
