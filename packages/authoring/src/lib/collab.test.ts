/**
 * @vitest-environment happy-dom
 *
 * The Stage 3c wiring, driven through a real Tiptap editor rather than through
 * the fragment API: this is the seam where the editor stops owning prose and
 * the document starts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { TimelineDoc, BODY_FIELD } from './doc.svelte.ts';
import { extensionsFor } from './richtext.ts';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((e) => e.destroy()); });

function mount(tl: TimelineDoc, selectedId: string) {
  const fragment = tl.fragmentFor(selectedId, BODY_FIELD);
  if (!fragment) throw new Error('expected a fragment');
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...extensionsFor(BODY_FIELD.options, true), Collaboration.configure({ fragment })],
  });
  editors.push(editor);
  return editor;
}

const withBody = (html: string) => ({ events: [{ unique_id: 'moon', text: { text: html } }] });

describe('an editor bound to a fragment', () => {
  it('opens showing the prose already in the document', () => {
    const tl = new TimelineDoc();
    tl.load(withBody('<p>One small step.</p>'));
    expect(mount(tl, 'moon').getHTML()).toBe('<p>One small step.</p>');
  });

  it('writes typing into the document, and the mirror follows', () => {
    const tl = new TimelineDoc();
    tl.load(withBody('<p>One small step.</p>'));
    const editor = mount(tl, 'moon');

    editor.commands.insertContentAt(1, 'That is ');
    tl.flushMirrors();

    expect(tl.events[0].text?.text).toBe('<p>That is One small step.</p>');
  });

  it('shows a change made to the document behind its back', () => {
    // What a collaborator's edit looks like locally in Phase 2, and what an
    // undo looks like in Phase 1 — neither goes through this editor.
    const tl = new TimelineDoc();
    tl.load(withBody('<p>One small step.</p>'));
    const editor = mount(tl, 'moon');

    const fragment = tl.fragmentFor('moon', BODY_FIELD)!;
    tl.doc.transact(() => {
      const para = fragment.get(0) as import('yjs').XmlElement;
      (para.get(0) as import('yjs').XmlText).insert(0, 'Remote: ');
    });

    expect(editor.getHTML()).toBe('<p>Remote: One small step.</p>');
  });

  it('has no undo of its own, so Yjs can own history', () => {
    const tl = new TimelineDoc();
    tl.load(withBody('<p>Body.</p>'));
    const editor = mount(tl, 'moon');
    // StarterKit's undoRedo is off for a collaborative field, so ProseMirror's
    // own history plugin is absent and cannot fight Yjs. Stage 6 supplies undo
    // through Y.UndoManager instead.
    const names = editor.extensionManager.extensions.map((e) => e.name);
    expect(names).not.toContain('undoRedo');
    expect(names).toContain('collaboration');
  });

  it('two editors on one document converge on a merge', () => {
    const a = new TimelineDoc();
    a.load(withBody('<p>One small step.</p>'));
    const b = new TimelineDoc();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    const ea = mount(a, 'moon');
    const eb = mount(b, 'moon');
    ea.commands.insertContentAt(1, 'That is ');
    eb.commands.insertContentAt(17, ' For a man.');

    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    expect(ea.getHTML()).toBe(eb.getHTML());
    expect(ea.getHTML()).toContain('That is ');
    expect(ea.getHTML()).toContain('For a man.');

    a.flushMirrors();
    expect(a.events[0].text?.text).toBe(ea.getHTML());
  });
});

describe('a field with no fragment', () => {
  it('falls back to plain HTML editing rather than failing', () => {
    const tl = new TimelineDoc();
    // An inline image cannot be represented, so ensureFragments declines.
    tl.load(withBody('<p>Before <img src="https://example.com/a.jpg"> after</p>'));
    expect(tl.fragmentFor('moon', BODY_FIELD)).toBeNull();
    expect(tl.events[0].text?.text).toContain('<img');
  });
});
