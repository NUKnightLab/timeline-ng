/**
 * @vitest-environment happy-dom
 *
 * The cases here are the focus moves a browser actually produces around an
 * open inline editor; the DOM only has to answer `contains`, which happy-dom
 * does without layout.
 */
import { describe, it, expect } from 'vitest';
import { focusLeftContainer } from './focusLeave.ts';

function tree() {
  const page = document.createElement('div'); // the editor's scroll container
  const editor = document.createElement('div'); // .media-editor-inline
  const tab = document.createElement('button'); // a control inside the editor
  const elsewhere = document.createElement('button'); // a control outside it
  editor.append(tab);
  page.append(editor);
  document.body.replaceChildren(page, elsewhere);
  return { page, editor, tab, elsewhere };
}

describe('focusLeftContainer', () => {
  it('stays open when focus moves to a control inside the editor', () => {
    const { editor, tab } = tree();
    expect(focusLeftContainer(editor, tab, true)).toBe(false);
  });

  it('leaves when focus moves to a control outside the editor', () => {
    const { editor, elsewhere } = tree();
    expect(focusLeftContainer(editor, elsewhere, false)).toBe(true);
  });

  it('stays open when pressing a non-focusable part drops focus to an ancestor', () => {
    // Clicking the upload dropzone's label: the pointer is inside, but the
    // browser hands focus up to the editor's scroll container.
    const { page, editor } = tree();
    expect(focusLeftContainer(editor, page, true)).toBe(false);
  });

  it('leaves when the press that dropped focus to an ancestor was outside', () => {
    const { page, editor } = tree();
    expect(focusLeftContainer(editor, page, false)).toBe(true);
  });

  it('falls back to the pointer when focus goes nowhere', () => {
    const { editor } = tree();
    expect(focusLeftContainer(editor, null, true)).toBe(false);
    expect(focusLeftContainer(editor, null, false)).toBe(true);
  });
});
