<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    value: string;
    onchange: (v: string) => void;
  }

  let { value, onchange }: Props = $props();

  let open      = $state(false);
  let openAbove = $state(false);
  let pickerEl  = $state<HTMLElement | null>(null);
  let wrapEl:   HTMLDivElement;

  // Convert any valid CSS color to the rgba() string the picker needs.
  // Canvas fillStyle is the cheapest browser-native parser: assign any CSS color,
  // read back either '#rrggbb' (opaque) or 'rgba(r, g, b, a)' (transparent).
  function toPickerColor(color: string): string {
    if (!color.trim()) return 'rgba(0, 0, 0, 1)';
    try {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = '#000'; // reset
      ctx.fillStyle = color;
      const out = ctx.fillStyle;
      if (out.startsWith('#')) {
        // opaque hex — expand to rgba
        const r = parseInt(out.slice(1, 3), 16);
        const g = parseInt(out.slice(3, 5), 16);
        const b = parseInt(out.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, 1)`;
      }
      return out; // already rgba(…)
    } catch {
      return 'rgba(0, 0, 0, 1)';
    }
  }

  const pickerColor = $derived(toPickerColor(value));

  onMount(async () => {
    await import('vanilla-colorful/rgba-string-color-picker.js');
  });

  // Forward color-changed events from the web component
  $effect(() => {
    if (!pickerEl) return;
    const handler = (e: Event) => {
      onchange((e as CustomEvent<{ value: string }>).detail.value);
    };
    pickerEl.addEventListener('color-changed', handler);
    return () => pickerEl?.removeEventListener('color-changed', handler);
  });

  // Flip above if there isn't enough space below
  $effect(() => {
    if (!open || !wrapEl) return;
    const rect = wrapEl.getBoundingClientRect();
    openAbove = window.innerHeight - rect.bottom < 300;
  });

  // Close on click-outside
  $effect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (!wrapEl.contains(e.target as Node)) open = false;
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  });
</script>

<div class="cp-wrap" bind:this={wrapEl}>
  <button
    type="button"
    class="cp-swatch"
    onclick={() => (open = !open)}
    aria-label="Open color picker"
    aria-expanded={open}
  ><span class="cp-color" style:background={value || 'transparent'}></span></button>

  {#if open}
    <div class="cp-popup" class:cp-popup--above={openAbove}>
      <!-- svelte-ignore svelte_component_deprecated -->
      <svelte:element
        this={"rgba-string-color-picker"}
        bind:this={pickerEl}
        color={pickerColor}
      ></svelte:element>
    </div>
  {/if}
</div>

<style>
  .cp-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .cp-swatch {
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0;
    cursor: pointer;
    display: block;
    overflow: hidden;
    /* Checkerboard to show through transparent colors */
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
    background-color: #fff;
  }

  /* Color layer sits on top of the checkerboard */
  .cp-color {
    display: block;
    width: 100%;
    height: 100%;
  }

  .cp-popup {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 200;
    box-shadow: 0 4px 16px rgba(0,0,0,0.18);
    border-radius: 6px;
    overflow: hidden;
  }

  .cp-popup--above {
    top: auto;
    bottom: calc(100% + 6px);
  }

  .cp-popup :global(rgba-string-color-picker) {
    --cp-border-color: #e0e0e0;
    --cp-border-radius: 0;
    width: 220px;
  }
</style>
