<script lang="ts">
  interface Props {
    hidetitle?: boolean;
  }

  let { hidetitle = false }: Props = $props();
</script>

<nav class="navbar app-navbar" aria-label="Site navigation">
  <a class="navbar-brand" href="https://knightlab.northwestern.edu" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.knightlab.com/libs/orangeline/latest/assets/knightlab-dark.png" alt="Knight Lab" class="brand-logo" />
  </a>
  {#if !hidetitle}
    <span class="navbar-divider" aria-hidden="true">|</span>
    <span class="navbar-title">TimelineJS Reimagined</span>
  {/if}
</nav>

<style>
  .app-navbar {
    display: flex;
    align-items: center;
    padding: 0 1.25rem;
    gap: 0.75rem;
    background: #1d1f21;
    border-bottom: 3px solid #df4e13;
    overflow: visible;
  }

  .navbar-brand {
    text-decoration: none;
    display: flex;
    align-items: center;
  }

  .brand-logo { height: 28px; width: auto; display: block; margin: 2px 0; }

  .navbar-divider { color: #444; user-select: none; }

  .navbar-title {
    font-size: 0.85rem;
    color: #b8b8b8;
    font-weight: 400;
    letter-spacing: 0.02em;
  }

  @media (max-width: 640px) {
    .app-navbar { justify-content: space-between; }
    .navbar-divider { display: none; }
    .navbar-title { font-size: 0.8rem; }
  }
</style>
