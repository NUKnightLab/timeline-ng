<script lang="ts">
	import HelpLink from './HelpLink.svelte';
  import { getAuthState, signIn, signOut, clearAuthError } from '../lib/atproto.svelte.ts';

  interface Props {
    onsignout?: () => void;
  }

  let { onsignout }: Props = $props();

  let handle = $state('');
  let submitting = $state(false);
  let showPanel = $state(false);
  let showAccountPanel = $state(false);
  let panelTop = $state(50);

  let triggerBtn = $state<HTMLButtonElement | null>(null);
  let handleInputEl = $state<HTMLInputElement | null>(null);

  $effect(() => { if (showPanel) handleInputEl?.focus(); });

  function togglePanel() {
    if (!showPanel) {
      if (!triggerBtn) return;
      const rect = triggerBtn.getBoundingClientRect();
      panelTop = rect.bottom + 8;
      clearAuthError();
    }
    showPanel = !showPanel;
  }

  function toggleAccountPanel() {
    if (!showAccountPanel) {
      if (!triggerBtn) return;
      const rect = triggerBtn.getBoundingClientRect();
      panelTop = rect.bottom + 8;
    }
    showAccountPanel = !showAccountPanel;
  }

  function handleSignOut() {
    showAccountPanel = false;
    (onsignout ?? signOut)();
  }

  const auth = $derived(getAuthState());

  function friendlyError(raw: string): string {
    const s = raw.toLowerCase();
    if (s.includes('resolve') || s.includes('handle') || s.includes('identity') || s.includes('404')) {
      return 'Handle not found — check the spelling and try again.';
    }
    if (s.includes('fetch') || s.includes('network') || s.includes('connect')) {
      return 'Connection failed — check your network or the handle resolver.';
    }
    if (s.includes('invalid') || s.includes('not a valid')) {
      return 'Invalid handle format.';
    }
    return 'Sign-in failed — try again.';
  }

  // ── Typeahead ─────────────────────────────────────────────────────────────

  type TypeaheadActor = { did: string; handle: string; displayName?: string; avatar?: string };

  let suggestions = $state<TypeaheadActor[]>([]);
  let suggestionIndex = $state(-1);
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

  function clearSuggestions() {
    suggestions = [];
    suggestionIndex = -1;
  }

  function onHandleInput() {
    clearAuthError();
    suggestionIndex = -1;
    if (typeaheadTimer) clearTimeout(typeaheadTimer);

    const q = handle.replace(/^@/, '').trim();
    if (q.length < 2 || q.startsWith('did:')) {
      suggestions = [];
      return;
    }

    typeaheadTimer = setTimeout(async () => {
      try {
        const resp = await fetch(
          `https://typeahead.waow.tech/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(q)}&limit=8`,
          { headers: { 'X-Client': 'timeline-ng' } }
        );
        if (!resp.ok) return;
        const data = await resp.json() as { actors: TypeaheadActor[] };
        suggestions = data.actors ?? [];
      } catch {
        // typeahead is best-effort; silence network errors
      }
    }, 250);
  }

  async function selectSuggestion(actor: TypeaheadActor) {
    handle = actor.handle;
    clearSuggestions();
    clearAuthError();
    submitting = true;
    await signIn(handle.trim());
    submitting = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      suggestionIndex = Math.min(suggestionIndex + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      suggestionIndex = Math.max(suggestionIndex - 1, -1);
    } else if (e.key === 'Enter' && suggestionIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[suggestionIndex]);
    } else if (e.key === 'Escape') {
      clearSuggestions();
    }
  }

  function onInputBlur() {
    // Delay so mousedown on a suggestion fires before we clear
    setTimeout(clearSuggestions, 150);
  }

  async function handleSignIn(e: Event) {
    e.preventDefault();
    if (!handle.trim()) return;
    clearSuggestions();
    submitting = true;
    await signIn(handle.trim());
    submitting = false;
  }
</script>

{#if auth.status === 'signed-in'}
  <div class="auth-signed-in">
    <button class="btn-avatar-toggle" bind:this={triggerBtn} onclick={toggleAccountPanel} aria-label="Account options">
      {#if auth.avatar}
        <img class="auth-avatar" src={auth.avatar} alt={auth.handle} />
      {:else}
        <span class="auth-initials">{auth.handle[0]?.toUpperCase() ?? '?'}</span>
      {/if}
    </button>
    <span class="auth-handle" title={auth.handle}>{auth.handle}</span>
    {#if showAccountPanel}
      <div class="auth-panel auth-account-panel" style="top: {panelTop}px">
        <p class="auth-account-handle">{auth.handle}</p>
        <button class="btn-signout-panel" onclick={handleSignOut}>Sign out</button>
      </div>
    {/if}
  </div>
{:else if auth.status === 'loading'}
  <span class="auth-loading">Signing in…</span>
{:else}
  <div class="auth-wrapper">
    <button class="btn-signin-trigger" bind:this={triggerBtn} onclick={togglePanel}>
      Sign in
    </button>
    {#if showPanel}
      <div class="auth-panel" style="top: {panelTop}px">
        <p class="auth-panel-label">Sign in with your <HelpLink doc="atmosphere">Atmosphere account</HelpLink>.</p>
        <div class="auth-input-wrap">
          <div class="auth-form-wrap">
          <form class="auth-form" onsubmit={handleSignIn}>
            <input
              bind:this={handleInputEl}
              role="combobox"
              class="auth-input"
              class:auth-input--error={auth.status === 'error'}
              type="text"
              placeholder="handle or DID"
              bind:value={handle}
              disabled={submitting}
              aria-label="AT Protocol handle"
              aria-describedby={auth.status === 'error' ? 'auth-error-msg' : undefined}
              aria-autocomplete="list"
              aria-expanded={suggestions.length > 0}
              aria-controls="auth-suggestions"
              autocomplete="off"
              oninput={onHandleInput}
              onkeydown={onKeydown}
              onblur={onInputBlur}
            />
            <button class="btn-go" type="submit" disabled={submitting || !handle.trim()}>
              {submitting ? '…' : 'Go'}
            </button>
          </form>
          {#if suggestions.length > 0}
            <ul id="auth-suggestions" class="auth-suggestions" role="listbox">
              {#each suggestions as actor, i}
                <li
                  class="auth-suggestion"
                  class:auth-suggestion--active={i === suggestionIndex}
                  role="option"
                  aria-selected={i === suggestionIndex}
                  onmousedown={(e) => { e.preventDefault(); selectSuggestion(actor); }}
                >
                  {#if actor.avatar}
                    <img class="suggestion-avatar" src={actor.avatar} alt="" />
                  {:else}
                    <span class="suggestion-avatar-placeholder"></span>
                  {/if}
                  <span class="suggestion-text">
                    {#if actor.displayName}
                      <span class="suggestion-display">{actor.displayName}</span>
                    {/if}
                    <span class="suggestion-handle">@{actor.handle}</span>
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
          </div>
          <p class="note">You don't have to sign in to make a timeline, but it's the easiest way to save and publish them.</p>

        </div>
        {#if auth.status === 'error'}
          <p id="auth-error-msg" class="auth-error" role="alert">
            {friendlyError(auth.error)}
          </p>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .auth-signed-in {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    position: relative;
  }

  .btn-avatar-toggle {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    width: 24px;
    height: 24px;
    line-height: 1;
    cursor: pointer;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .btn-avatar-toggle:hover { opacity: 0.85; }

  .auth-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .auth-initials {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #4b5563;
    color: #e5e7eb;
    font-size: 0.7rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .auth-handle {
    font-size: 0.8rem;
    color: #b8b8b8;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .auth-account-panel {
    min-width: 180px;
  }

  .auth-account-handle {
    font-size: 0.85rem;
    color: #111;
    font-weight: 500;
    margin: 0 0 0.5rem;
    word-break: break-all;
  }

  .btn-signout-panel {
    background: transparent;
    border: 1px solid #d1d5db;
    color: #374151;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    font-family: inherit;
    font-weight: normal;
    text-transform: none;
    cursor: pointer;
    border-radius: 2px;
    margin: 0;
    width: 100%;
  }
  .btn-signout-panel:hover { border-color: #9ca3af; background: #f9fafb; }

  @media (max-width: 640px) {
    .auth-handle { display: none; }
  }

  .auth-loading {
    font-size: 0.8rem;
    color: #888;
  }

  .auth-wrapper {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0;
    position: relative;
  }

  .btn-signin-trigger {
    background: transparent;
    border: 1px solid #555;
    color: #b8b8b8;
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: normal;
    text-transform: none;
    border-radius: 2px;
    cursor: pointer;
    white-space: nowrap;
    margin-bottom: 0;
  }
  .btn-signin-trigger:hover { border-color: #b8b8b8; color: #fff; }

  .auth-panel {
    position: fixed;
    top: 50px;
    right: 1rem;
    background: #fff;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    padding: 1rem;
    width: 280px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .auth-panel-label {
    font-size: 0.85rem;
    color: #374151;
    margin: 0;
    font-weight: 500;
  }

  .auth-form-wrap {
    position: relative;
  }

  .auth-form {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .auth-suggestions {
    display: flex;
    flex-direction: column;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #fff;
    border: 1px solid #d1d5db;
    border-top: none;
    border-radius: 0 0 4px 4px;
    box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    list-style: none;
    padding: 0;
    margin: 0;
    text-align: left;
    z-index: 10;
    max-height: 220px;
    overflow-y: auto;
  }

  .auth-suggestion {
    display: flex;
    align-items: center;
    text-align: left;
    width: 100%;
    box-sizing: border-box;
    padding-left: 0.5rem;
    margin-left: 0;
    gap: 0.45rem;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    border-bottom: 1px solid #f3f4f6;
  }
  .auth-suggestion:last-child { border-bottom: none; }
  .auth-suggestion:hover,
  .auth-suggestion--active { background: #f9fafb; }

  .suggestion-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }
  .suggestion-avatar-placeholder {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #e5e7eb;
    flex-shrink: 0;
  }

  .suggestion-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .suggestion-display {
    font-size: 0.78rem;
    color: #111827;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .suggestion-handle {
    font-size: 0.7rem;
    color: #6b7280;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .auth-input {
    background: #fff;
    border: 1px solid #d1d5db;
    color: #111827;
    padding: 0.35rem 0.5rem;
    font-size: 0.85rem;
    font-family: inherit;
    border-radius: 2px;
    flex: 1;
  }
  .auth-input::placeholder { color: #9ca3af; }
  .auth-input:focus { outline: none; border-color: #df4e13; }
  .auth-input--error { border-color: #f87171; }

  .btn-go {
    background: #df4e13;
    border: 1px solid #df4e13;
    color: #fff;
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    border-radius: 2px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-go:hover:not(:disabled) { background: #c44310; }
  .btn-go:disabled { opacity: 0.5; cursor: default; }

  .auth-error {
    font-size: 0.78rem;
    color: #b91c1c;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 2px;
    padding: 0.25rem 0.5rem;
    margin: 0;
    line-height: 1.3;
  }
</style>
