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

describe('binding to a fragment does not change how commands behave', () => {
  // Structural commands — wrapping, splitting — are the ones that break when
  // prosemirror-model is loaded twice, because the schema's node type and the
  // document's are then different objects. Rather than assert particular HTML
  // (a headless editor has no real selection, and produces artefacts that say
  // nothing about the browser), each command is run through a collaborative
  // editor and a plain one and the results compared. That is the property that
  // matters: Stage 3 must not have changed what these commands do.
  const run = (html: string, act: (e: Editor) => void) => {
    const results: string[] = [];
    for (const collaborative of [false, true]) {
      const tl = new TimelineDoc();
      tl.load(withBody(html));
      const fragment = tl.fragmentFor('moon', BODY_FIELD)!;
      const editor = new Editor({
        element: document.createElement('div'),
        extensions: [
          ...extensionsFor(BODY_FIELD.options, collaborative),
          ...(collaborative ? [Collaboration.configure({ fragment })] : []),
        ],
        ...(collaborative ? {} : { content: html }),
      });
      editors.push(editor);
      act(editor);
      results.push(editor.getHTML());
    }
    return results;
  };

  it.each([
    ['blockquote', '<p>Quote me.</p>', (e: Editor) => { e.commands.selectAll(); e.commands.toggleBlockquote(); }],
    ['unwrapping a blockquote', '<blockquote><p>Quote me.</p></blockquote>', (e: Editor) => { e.commands.selectAll(); e.commands.toggleBlockquote(); }],
    ['bullet list', '<p>An item.</p>', (e: Editor) => { e.commands.selectAll(); e.commands.toggleBulletList(); }],
    ['splitting on Enter', '<p>Before after</p>', (e: Editor) => { e.commands.setTextSelection(7); e.commands.splitBlock(); }],
    ['heading', '<p>A title</p>', (e: Editor) => { e.commands.selectAll(); e.commands.toggleHeading({ level: 2 }); }],
  ])('%s matches a plain editor', (_label, html, act) => {
    const [plain, collab] = run(html, act);
    expect(collab).toBe(plain);
  });

  it('can wrap a paragraph in a blockquote at all', () => {
    // The half of the duplicate-module symptom that is unambiguous: with two
    // copies of prosemirror-model, `can()` returns false because the node type
    // cannot be matched, so the button removes quotes but never creates one.
    const tl = new TimelineDoc();
    tl.load(withBody('<p>Quote me.</p>'));
    const editor = mount(tl, 'moon');
    editor.commands.selectAll();
    expect(editor.can().toggleBlockquote()).toBe(true);
    expect(editor.can().toggleBulletList()).toBe(true);
    expect(editor.getHTML()).not.toContain('blockquote');
    editor.commands.toggleBlockquote();
    expect(editor.getHTML()).toContain('<blockquote>');
  });
});
