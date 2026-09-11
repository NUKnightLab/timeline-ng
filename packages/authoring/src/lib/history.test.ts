/**
 * @vitest-environment happy-dom
 *
 * Undo for the whole timeline. The interesting cases are not "undo reverts an
 * edit" — Yjs does that — but the ways the stack could quietly go wrong: writes
 * that should never be undoable, and writes that would silently clear redo.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import { TimelineDoc, BODY_FIELD } from './doc.svelte.ts';
import { slidesMap } from './doc.ts';
import { extensionsFor } from './richtext.ts';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((e) => e.destroy()); });

const moon = {
  unique_id: 'moon',
  text: { headline: '<p>The Moon</p>', text: '<p>One small step.</p>' },
  media: { url: 'https://example.com/m.jpg', caption: 'Apollo' },
};

function loaded() {
  const tl = new TimelineDoc();
  tl.load({ events: [moon], settings: {} });
  return { tl, key: tl.entries[0].key };
}

describe('writes that must never be undoable', () => {
  it('loading a timeline', () => {
    // Otherwise the first Cmd-Z after opening a timeline empties it.
    const { tl } = loaded();
    expect(tl.canUndo).toBe(false);
    expect(tl.undo()).toBe(false);
    expect(tl.entries).toHaveLength(1);
  });

  it('recording a save, and the record it was saved to', () => {
    const { tl } = loaded();
    tl.markClean();
    tl.setAtUri('at://did:plc:x/c/1');
    expect(tl.canUndo).toBe(false);
  });

  it('a title derived from the title slide headline', () => {
    const { tl } = loaded();
    tl.setTitle('The Moon', false, { derived: true });
    expect(tl.canUndo).toBe(false);
  });

  it('keeping HTML mirrors in step with their fragments', () => {
    const { tl, key } = loaded();
    const fragment = tl.fragmentFor(key, BODY_FIELD)!;
    // Tagged as typing, so it IS tracked — otherwise the stack would be empty
    // before and after and this would pass whether mirrors were tracked or not.
    tl.doc.transact(() => ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'X'), ySyncPluginKey);
    expect(tl.undoDepth).toBe(1);
    tl.flushMirrors();
    expect(tl.undoDepth).toBe(1);
  });
});

describe('user edits', () => {
  it('undo and redo a field', () => {
    const { tl, key } = loaded();
    tl.updateEvent(key, { ...moon, group: 'Missions' });
    expect(tl.eventForKey(key)?.group).toBe('Missions');

    expect(tl.undo()).toBe(true);
    expect(tl.eventForKey(key)?.group).toBeUndefined();
    expect(tl.canRedo).toBe(true);

    expect(tl.redo()).toBe(true);
    expect(tl.eventForKey(key)?.group).toBe('Missions');
  });

  it('an explicit title is undoable, unlike a derived one', () => {
    const { tl } = loaded();
    tl.setTitle('Spaceflight', true);
    expect(tl.canUndo).toBe(true);
    tl.undo();
    expect(tl.title).toBe('');
  });

  it('deleting a slide comes back under the same key, prose intact', () => {
    const { tl, key } = loaded();
    tl.captureBoundary();
    tl.removeEvent(key);
    expect(tl.entries).toHaveLength(0);

    tl.undo();
    expect(tl.entries.map((e) => e.key)).toEqual([key]);
    tl.flushMirrors();
    expect(tl.eventForKey(key)?.text?.text).toBe('<p>One small step.</p>');
  });

  it('settings share the stack', () => {
    const { tl, key } = loaded();
    tl.patchSettings({ language: 'es' });
    tl.captureBoundary();
    tl.updateEvent(key, { ...moon, group: 'Missions' });
    tl.undo();
    tl.undo();
    expect(tl.settings.language).toBeUndefined();
  });
});

describe('knowing the target before undoing', () => {
  it('peekUndo names the slide and field undo is about to change', () => {
    const { tl, key } = loaded();
    tl.updateEvent(key, { ...moon, media: { ...moon.media, caption: 'Apollo 11' } });
    expect(tl.peekUndo()).toEqual({ kind: 'slide', slideKey: key, field: 'caption' });
    expect(tl.eventForKey(key)?.media?.caption).toBe('Apollo 11');
  });

  it('peekRedo names it after undoing', () => {
    const { tl, key } = loaded();
    tl.updateEvent(key, { ...moon, group: 'Missions' });
    tl.undo();
    expect(tl.peekRedo()).toEqual({ kind: 'slide', slideKey: key, field: 'group' });
  });

  it('nothing to peek at on an empty stack', () => {
    const { tl } = loaded();
    expect(tl.peekUndo()).toBeNull();
    expect(tl.peekRedo()).toBeNull();
  });
});

describe('writes that arrive while history is being applied', () => {
  it('are dropped, so redo survives', () => {
    // Stands in for EventEditor: a mounted rich-text editor fires onchange
    // synchronously during an undo and re-emits the slide from stale local
    // copies. Here an observer does the same thing inside the undo transaction.
    const { tl, key } = loaded();
    tl.updateEvent(key, { ...moon, group: 'Missions' });

    const stale = { ...moon, group: 'Missions' };
    const echo = () => { if (tl.applyingHistory) tl.updateEvent(key, stale); };
    slidesMap(tl.doc).observeDeep(echo);

    tl.undo();
    slidesMap(tl.doc).unobserveDeep(echo);

    expect(tl.eventForKey(key)?.group).toBeUndefined();
    expect(tl.canRedo).toBe(true);
  });
});

describe('the deleted-slide restore row', () => {
  it('can tell whether a deletion is still next in line', () => {
    const { tl, key } = loaded();
    tl.captureBoundary();
    tl.removeEvent(key);
    const deletion = tl.latestUndoItem()!;
    expect(tl.isNextUndo(deletion)).toBe(true);

    tl.captureBoundary();
    tl.patchSettings({ language: 'es' });
    expect(tl.isNextUndo(deletion)).toBe(false);
  });

  it('forgetting a deletion stops Cmd-Z restoring a second copy', () => {
    const { tl, key } = loaded();
    tl.captureBoundary();
    tl.removeEvent(key);
    const deletion = tl.latestUndoItem()!;

    // The restore row re-adds the slide some other way…
    tl.captureBoundary();
    tl.addEvent(moon);
    tl.forgetUndoItem(deletion);

    // …so undoing now removes that re-add, and nothing more.
    tl.undo();
    expect(tl.entries).toHaveLength(0);
    expect(tl.undo()).toBe(false);
  });
});

describe('typing, through a real editor', () => {
  it('is undoable, which only works if ySyncPluginKey is the instance Collaboration uses', () => {
    // A second copy of @tiptap/y-tiptap would give an origin that looks right
    // and never matches, and typing would silently never be undoable.
    const { tl, key } = loaded();
    const fragment = tl.fragmentFor(key, BODY_FIELD)!;
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: [...extensionsFor(BODY_FIELD.options, true), Collaboration.configure({ fragment })],
    });
    editors.push(editor);

    editor.commands.insertContentAt(1, 'That is ');
    expect(editor.getHTML()).toBe('<p>That is One small step.</p>');
    expect(tl.canUndo).toBe(true);

    tl.undo();
    expect(editor.getHTML()).toBe('<p>One small step.</p>');
  });
});

describe('whether a deletion is still undoable', () => {
  // What the restore row checks before taking itself down. Undo has already
  // brought the slide back, so a row still offering to restore it would add a
  // second copy.
  it('goes false once the deletion has been undone', () => {
    const { tl, key } = loaded();
    tl.captureBoundary();
    tl.removeEvent(key);
    const deletion = tl.latestUndoItem()!;
    expect(tl.hasUndoItem(deletion)).toBe(true);

    tl.undo();
    expect(tl.hasUndoItem(deletion)).toBe(false);
    expect(tl.entries.map((e) => e.key)).toEqual([key]);
  });

  it('stays true when something else was undone', () => {
    const { tl, key } = loaded();
    tl.captureBoundary();
    tl.removeEvent(key);
    const deletion = tl.latestUndoItem()!;
    tl.captureBoundary();
    tl.patchSettings({ language: 'es' });

    tl.undo();   // the settings change, not the deletion
    expect(tl.hasUndoItem(deletion)).toBe(true);
    expect(tl.entries).toHaveLength(0);
  });
});
