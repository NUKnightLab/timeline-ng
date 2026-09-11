/**
 * @vitest-environment happy-dom
 *
 * Undo reveals what it is about to change before changing it, so it has to know
 * the target from the captured change alone. Each case is one kind of edit the
 * editor can make, and the question is only ever "which slide, which field".
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  RICH_TEXT_FIELDS, addSlide, createDoc, metaMap, removeSlide, slideFragment, slidesMap,
  titleMap, writeMeta, writeSettings, writeSlide,
} from './doc.ts';
import { targetFor } from './historyTarget.ts';
import type { HistoryTarget } from './historyTarget.ts';

const BODY = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'text')!;
const HEADLINE = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'headline')!;

/** Run `fn` in one transaction and return what it would reveal. */
function reveal(doc: Y.Doc, fn: () => void): HistoryTarget | null {
  let captured: Map<unknown, unknown[]> | null = null;
  const handler = (tr: Y.Transaction) => { captured = tr.changedParentTypes as unknown as Map<unknown, unknown[]>; };
  doc.on('afterTransaction', handler);
  doc.transact(fn);
  doc.off('afterTransaction', handler);
  return captured ? targetFor(doc, captured) : null;
}

const base = {
  unique_id: 'moon',
  start_date: { year: 1969, month: 7, day: 20 },
  text: { headline: '<p>The Moon</p>', text: '<p>One small step.</p>' },
  media: { url: 'https://example.com/m.jpg', caption: 'Apollo' },
  background: { color: '#000' },
};

function withSlide() {
  const doc = createDoc();
  const key = addSlide(doc, base);
  return { doc, key, slide: slidesMap(doc).get(key)! };
}

describe('fields on a slide', () => {
  it.each([
    ['group', { ...base, group: 'Missions' }, 'group'],
    ['slide ID', { ...base, unique_id: 'apollo-11' }, 'slideId'],
    ['media position', { ...base, media_position: 'right' as const }, 'media'],
    ['caption', { ...base, media: { ...base.media, caption: 'Apollo 11' } }, 'caption'],
    ['credit', { ...base, media: { ...base.media, credit: 'NASA' } }, 'credit'],
    ['alt text', { ...base, media: { ...base.media, alt: 'A footprint' } }, 'alt'],
    ['media URL', { ...base, media: { ...base.media, url: 'https://example.com/n.jpg' } }, 'media'],
    ['start date', { ...base, start_date: { ...base.start_date, day: 21 } }, 'date'],
    ['end date', { ...base, end_date: { year: 1969, month: 7, day: 24 } }, 'date'],
    ['background', { ...base, background: { color: '#123' } }, 'background'],
  ])('%s', (_label, next, field) => {
    const { doc, key, slide } = withSlide();
    expect(reveal(doc, () => writeSlide(slide, next))).toEqual({ kind: 'slide', slideKey: key, field });
  });
});

describe('rich text', () => {
  it.each([
    ['body', BODY, 'body'],
    ['headline', HEADLINE, 'headline'],
  ] as const)('an edit inside the %s fragment', (_label, rich, field) => {
    const { doc, key, slide } = withSlide();
    const fragment = slideFragment(slide, rich);
    const text = (fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText;
    expect(reveal(doc, () => text.insert(0, 'Edited '))).toEqual({ kind: 'slide', slideKey: key, field });
  });
});

describe('slides appearing and going', () => {
  it('adding a slide reveals the slide, not a field inside it', () => {
    const doc = createDoc();
    let key = '';
    const target = reveal(doc, () => { key = addSlide(doc, base); });
    expect(target).toEqual({ kind: 'slide', slideKey: key, field: 'slide' });
  });

  it('removing a slide reveals the slide it removed', () => {
    const { doc, key } = withSlide();
    expect(reveal(doc, () => removeSlide(doc, key))).toEqual({ kind: 'slide', slideKey: key, field: 'slide' });
  });
});

describe('the title slide', () => {
  it('a field on it is addressed as "title"', () => {
    const doc = createDoc();
    writeSlide(titleMap(doc), { unique_id: 'title', text: { headline: '<p>Space</p>' } });
    const target = reveal(doc, () => writeSlide(titleMap(doc), { unique_id: 'intro', text: { headline: '<p>Space</p>' } }));
    expect(target).toEqual({ kind: 'slide', slideKey: 'title', field: 'slideId' });
  });

  it('removing it reveals the slide rather than one of its fields', () => {
    const doc = createDoc();
    writeSlide(titleMap(doc), { unique_id: 'title', group: 'Intro' });
    expect(reveal(doc, () => titleMap(doc).clear())).toEqual({ kind: 'slide', slideKey: 'title', field: 'slide' });
  });
});

describe('outside the slides', () => {
  it('settings', () => {
    const doc = createDoc();
    writeSettings(doc, { language: 'en' });
    expect(reveal(doc, () => writeSettings(doc, { language: 'es' }))).toEqual({ kind: 'settings' });
  });

  it('the timeline title', () => {
    const doc = createDoc();
    expect(reveal(doc, () => writeMeta(doc, { title: 'Space' }))).toEqual({ kind: 'title' });
  });

  it('nothing it recognises', () => {
    const doc = createDoc();
    expect(reveal(doc, () => doc.getMap('elsewhere').set('x', 1))).toBeNull();
  });
});

// Referenced so an unused-import lint does not strip the helper the title case relies on.
void metaMap;

describe('called from where it is actually used', () => {
  it('works inside an UndoManager stack-item-added listener', () => {
    // The listener fires after Yjs has run event handlers, and Yjs refuses to
    // compute YEvent.changes from that point on. The earlier version of this
    // module read `changes` and threw here while passing every test that
    // called it from a plain afterTransaction handler.
    const doc = createDoc();
    const undo = new Y.UndoManager([slidesMap(doc), titleMap(doc)]);
    const seen: (HistoryTarget | null)[] = [];
    undo.on('stack-item-added', ({ changedParentTypes }) => {
      seen.push(targetFor(doc, changedParentTypes as unknown as Map<unknown, unknown[]>));
    });

    let key = '';
    doc.transact(() => { key = addSlide(doc, base); });
    undo.stopCapturing();
    doc.transact(() => removeSlide(doc, key));
    undo.stopCapturing();
    doc.transact(() => writeSlide(titleMap(doc), { unique_id: 'title', group: 'Intro' }));
    undo.stopCapturing();
    doc.transact(() => titleMap(doc).clear());

    expect(seen).toEqual([
      { kind: 'slide', slideKey: key, field: 'slide' },
      { kind: 'slide', slideKey: key, field: 'slide' },
      { kind: 'slide', slideKey: 'title', field: 'slide' },
      { kind: 'slide', slideKey: 'title', field: 'slide' },
    ]);
  });
});
