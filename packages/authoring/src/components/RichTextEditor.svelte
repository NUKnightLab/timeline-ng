<script lang="ts">
  import { tick } from 'svelte';
  import { onMount } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Link from '@tiptap/extension-link';
  import DOMPurify from 'dompurify';

  interface Props {
    id?: string;
    value: string;
    onchange: (html: string) => void;
    minimal?: boolean;
    inlineOnly?: boolean;
    noLink?: boolean;
    singleLine?: boolean;
    rows?: number;
    autofocus?: boolean;
    onconfirm?: () => void;
  }

  let {
    id,
    value,
    onchange,
    minimal = false,
    inlineOnly = false,
    noLink = false,
    singleLine = false,
    rows = 4,
    autofocus = false,
    onconfirm,
  }: Props = $props();

  let element: HTMLDivElement;
  let editor = $state<Editor | null>(null);

  // Active state for toolbar buttons
  let isBold      = $state(false);
  let isItalic    = $state(false);
  let isLink      = $state(false);
  let isH2        = $state(false);
  let isH3        = $state(false);
  let isBullet    = $state(false);
  let isOrdered   = $state(false);
  let isQuote     = $state(false);

  // Inline link editor
  let showLinkInput = $state(false);
  let linkHref      = $state('');
  let linkInputEl = $state<HTMLInputElement | null>(null);

  // Raw HTML mode
  let showRaw    = $state(false);
  let rawSource  = $state('');
  let rawEl = $state<HTMLTextAreaElement | null>(null);

  async function toggleRaw() {
    if (!editor) return;
    showLinkInput = false;
    if (!showRaw) {
      rawSource = editor.getHTML();
      showRaw = true;
      await tick();
      rawEl?.focus();
    } else {
      const clean = DOMPurify.sanitize(rawSource, { USE_PROFILES: { html: true } });
      showRaw = false;
      await tick();
      editor.commands.setContent(clean);
      editor.commands.focus();
      onchange(clean === '<p></p>' ? '' : clean);
    }
  }

  function syncMarks() {
    if (!editor) return;
    isBold    = editor.isActive('bold');
    isItalic  = editor.isActive('italic');
    isLink    = noLink ? false : editor.isActive('link');
    if (!minimal && !inlineOnly) {
      isH2     = editor.isActive('heading', { level: 2 });
      isH3     = editor.isActive('heading', { level: 3 });
      isBullet = editor.isActive('bulletList');
      isOrdered= editor.isActive('orderedList');
      isQuote  = editor.isActive('blockquote');
    }
  }

  async function openLinkInput() {
    if (!editor) return;
    linkHref = editor.getAttributes('link').href ?? '';
    showLinkInput = true;
    await tick();
    linkInputEl?.focus();
    linkInputEl?.select();
  }

  function applyLink() {
    if (!editor) return;
    const url = linkHref.trim();
    if (url) {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
    showLinkInput = false;
  }

  function closeLinkInput() {
    showLinkInput = false;
    editor?.chain().focus().run();
  }

  onMount(() => {
    const linkExt = Link.configure({ openOnClick: false, autolink: true });
    const starter = StarterKit.configure({
      heading: minimal || inlineOnly ? false : undefined,
      blockquote: minimal || inlineOnly ? false : undefined,
      bulletList: minimal || inlineOnly ? false : undefined,
      orderedList: minimal || inlineOnly ? false : undefined,
      codeBlock: minimal || inlineOnly ? false : undefined,
      horizontalRule: minimal || inlineOnly ? false : undefined,
      strike: minimal || inlineOnly ? false : undefined,
      code: minimal || inlineOnly ? false : undefined,
      hardBreak: singleLine ? false : undefined,
    });
    const extensions = noLink ? [starter] : [starter, linkExt];

    const instance = new Editor({
      element,
      extensions,
      content: value || '',
      autofocus: autofocus ? 'end' : false,
      editorProps: {
        attributes: {
          class: `rte-content${singleLine ? ' rte-content--singleline' : ''}`,
          ...(id ? { id } : {}),
        },
        handleKeyDown: (_view, event) => {
          if (singleLine && event.key === 'Enter') {
            event.preventDefault();
            onconfirm?.();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        onchange(html === '<p></p>' ? '' : html);
        syncMarks();
      },
      onSelectionUpdate: () => syncMarks(),
    });

    editor = instance;
    return () => instance.destroy();
  });

  // Sync external value changes (e.g. event switched without key remount)
  $effect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '');
    }
  });
</script>

<div class="rte" style:--rte-rows={rows} class:rte--raw={showRaw} class:rte--singleline={singleLine}>
  <div class="rte-toolbar-wrap">
    <div class="rte-toolbar" role="toolbar" aria-label="Text formatting">

      <button type="button" class="rte-btn" class:active={isBold}
        aria-label="Bold" aria-pressed={isBold}
        onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBold().run(); }}>
        <b>B</b>
      </button>

      <button type="button" class="rte-btn" class:active={isItalic}
        aria-label="Italic" aria-pressed={isItalic}
        onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleItalic().run(); }}>
        <i>I</i>
      </button>

      {#if !minimal && !inlineOnly}
        <span class="rte-sep"></span>

        <button type="button" class="rte-btn rte-btn--text" class:active={isH2}
          aria-label="Heading 2" aria-pressed={isH2}
          onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 2 }).run(); }}>
          H2
        </button>

        <button type="button" class="rte-btn rte-btn--text" class:active={isH3}
          aria-label="Heading 3" aria-pressed={isH3}
          onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleHeading({ level: 3 }).run(); }}>
          H3
        </button>

        <span class="rte-sep"></span>

        <button type="button" class="rte-btn" class:active={isBullet}
          aria-label="Bullet list" aria-pressed={isBullet}
          onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBulletList().run(); }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <circle cx="1.5" cy="3.5" r="1.5"/>
            <rect x="4" y="3" width="10" height="1"/>
            <circle cx="1.5" cy="7" r="1.5"/>
            <rect x="4" y="6.5" width="10" height="1"/>
            <circle cx="1.5" cy="10.5" r="1.5"/>
            <rect x="4" y="10" width="10" height="1"/>
          </svg>
        </button>

        <button type="button" class="rte-btn" class:active={isOrdered}
          aria-label="Ordered list" aria-pressed={isOrdered}
          onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleOrderedList().run(); }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
            <text x="0" y="4.5" font-size="4.5" font-family="monospace">1.</text>
            <rect x="5" y="3" width="9" height="1"/>
            <text x="0" y="8.5" font-size="4.5" font-family="monospace">2.</text>
            <rect x="5" y="7.5" width="9" height="1"/>
            <text x="0" y="12.5" font-size="4.5" font-family="monospace">3.</text>
            <rect x="5" y="12" width="9" height="1"/>
          </svg>
        </button>

        <span class="rte-sep"></span>

        <button type="button" class="rte-btn rte-btn--text" class:active={isQuote}
          aria-label="Blockquote" aria-pressed={isQuote}
          onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().toggleBlockquote().run(); }}>
          "
        </button>
      {/if}

      {#if !noLink}
        <span class="rte-sep"></span>

        <button type="button" class="rte-btn rte-btn--text" class:active={isLink || showLinkInput}
          aria-label="Link" aria-pressed={isLink}
          onmousedown={(e) => { e.preventDefault(); showLinkInput ? closeLinkInput() : openLinkInput(); }}>
          URL
        </button>
      {/if}

      <span class="rte-sep"></span>

      <button type="button" class="rte-btn rte-btn--text" class:active={showRaw}
        aria-label="Edit raw HTML" aria-pressed={showRaw}
        title={showRaw ? 'Apply HTML and return to editor' : 'Edit raw HTML'}
        onmousedown={(e) => { e.preventDefault(); toggleRaw(); }}>
        &lt;&gt;
      </button>

    </div>

    {#if showLinkInput}
      <div class="rte-link-row">
        <input
          bind:this={linkInputEl}
          class="rte-link-input"
          type="url"
          placeholder="https://"
          bind:value={linkHref}
          onkeydown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
            if (e.key === 'Escape') { e.preventDefault(); closeLinkInput(); }
          }}
        />
        <button type="button" class="rte-link-apply" onmousedown={(e) => { e.preventDefault(); applyLink(); }}>
          Apply
        </button>
        {#if isLink}
          <button type="button" class="rte-link-remove" onmousedown={(e) => { e.preventDefault(); editor?.chain().focus().unsetLink().run(); showLinkInput = false; }}>
            Remove
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <div class="rte-body" class:rte-body--hidden={showRaw} bind:this={element}></div>

  {#if showRaw}
    <textarea
      bind:this={rawEl}
      class="rte-raw"
      style:--rte-rows={rows}
      bind:value={rawSource}
      onkeydown={(e) => {
        if (singleLine && e.key === 'Enter') e.preventDefault();
      }}
      oninput={() => {
        if (singleLine) rawSource = rawSource.replace(/[\r\n]+/g, '');
      }}
      spellcheck="false"
      aria-label="Raw HTML source"
    ></textarea>
  {/if}
</div>

<style>
  .rte {
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    overflow: hidden;
    transition: border-color 0.15s;
    background: #fff;
  }
  .rte:focus-within {
    border-color: #13a4df;
    box-shadow: 0 0 0 2px rgba(19,164,223,0.2);
  }

  /* Toolbar slides in on focus */
  .rte-toolbar-wrap {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.15s ease;
  }
  .rte:focus-within .rte-toolbar-wrap,
  .rte--raw .rte-toolbar-wrap {
    max-height: 80px;
  }

  .rte-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 1px;
    padding: 4px;
    background: #f7f7f7;
    border-bottom: 1px solid #e8e8e8;
  }

  .rte-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    width: 26px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.82rem;
    color: #444;
    padding: 0;
    line-height: 1;
    transition: background 0.1s, border-color 0.1s;
    flex-shrink: 0;
    margin-bottom: 0;
    text-transform: none;
    font-weight: normal;
  }
  .rte-btn--text { font-size: 0.72rem; font-weight: 700; letter-spacing: -0.02em; }
  .rte-btn:hover { background: #ebebeb; border-color: #d4d4d4; }
  .rte-btn.active { background: #e0effe; border-color: #13a4df; color: #0a7cb8; }

  .rte-sep {
    width: 1px;
    height: 16px;
    background: #d4d4d4;
    margin: 0 3px;
    flex-shrink: 0;
  }

  /* Inline link row */
  .rte-link-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    background: #f0f8ff;
    border-bottom: 1px solid #bee3f8;
  }

  .rte-link-input {
    flex: 1;
    border: 1px solid #bee3f8;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 0.8rem;
    font-family: inherit;
    background: #fff;
    color: #1d1f21;
    min-width: 0;
  }
  .rte-link-input:focus { outline: none; border-color: #13a4df; }

  .rte-link-apply, .rte-link-remove {
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 0.75rem;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    margin-bottom: 0;
    text-transform: none;
    font-weight: normal;
  }
  .rte-link-apply {
    background: #13a4df;
    border: 1px solid #0a7cb8;
    color: #fff;
  }
  .rte-link-apply:hover { background: #0a7cb8; }
  .rte-link-remove {
    background: none;
    border: 1px solid #d4d4d4;
    color: #c0392b;
  }
  .rte-link-remove:hover { background: #fdf0ee; border-color: #c0392b; }

  .rte-body--hidden { display: none; }

  .rte-raw {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: calc(var(--rte-rows, 4) * 1.6em + 0.9rem);
    padding: 0.45rem 0.6rem;
    font-size: 0.8rem;
    font-family: 'Courier New', Consolas, monospace;
    line-height: 1.5;
    color: #1d1f21;
    background: #fafafa;
    border: none;
    outline: none;
    resize: vertical;
  }
  .rte--singleline .rte-raw {
    min-height: auto;
    white-space: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    resize: none;
  }

  /* Editor content */
  .rte-body :global(.rte-content) {
    padding: 0.45rem 0.6rem;
    min-height: calc(var(--rte-rows, 4) * 1.6em + 0.9rem);
    font-size: 0.9rem;
    line-height: 1.6;
    font-family: system-ui, sans-serif;
    outline: none;
    color: #1d1f21;
  }
  .rte-body :global(.rte-content--singleline) {
    min-height: auto;
    white-space: nowrap;
    overflow: hidden;
    line-height: 1.3;
    font-size: 1.35rem;
    font-weight: 700;
  }

  .rte-body :global(.rte-content > * + *) { margin-top: 0.4em; }
  .rte-body :global(.rte-content p)  { margin: 0; }
  .rte-body :global(.rte-content--singleline > * + *) { margin-top: 0; }
  .rte-body :global(.rte-content--singleline p) { margin: 0; }
  .rte-body :global(.rte-content h2) { font-size: 1.1rem; font-weight: 700; margin: 0; }
  .rte-body :global(.rte-content h3) { font-size: 0.95rem; font-weight: 700; margin: 0; }
  .rte-body :global(.rte-content ul) { margin: 0; padding-left: 1.4em; list-style: disc; }
  .rte-body :global(.rte-content ol) { margin: 0; padding-left: 1.4em; list-style: decimal; }
  .rte-body :global(.rte-content li) { margin: 0; }
  .rte-body :global(.rte-content blockquote) {
    margin: 0;
    padding-left: 0.75em;
    border-left: 3px solid #d4d4d4;
    color: #666;
    font-style: italic;
  }
  .rte-body :global(.rte-content a) { color: #13a4df; text-decoration: underline; }
</style>
