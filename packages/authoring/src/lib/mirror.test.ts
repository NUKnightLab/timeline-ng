/**
 * @vitest-environment happy-dom
 *
 * The HTML mirror must never disagree with the fragment it is derived from:
 * the fragment is what authors edit, the mirror is what gets published, and a
 * divergence means shipping a paragraph nobody wrote. See phase1-plan.md [P10].
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { TimelineDoc } from './doc.svelte.ts';
import { listSlides, slideFragment, slidesMap, RICH_TEXT_FIELDS } from './doc.ts';
import { fragmentToHtml, schemaFor } from './richtext.ts';

const BODY_FIELD = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'text')!;

function timelineWith(headline: string, body: string) {
  return { events: [{ unique_id: 'moon', text: { headline, text: body } }] };
}

describe('fragments are seeded from the HTML a timeline arrives with', () => {
  it('parses existing prose into a fragment', () => {
    const tl = new TimelineDoc();
    tl.load(timelineWith('<p>The Moon Landing</p>', '<p>One <em>small</em> step.</p>'));
    const key = listSlides(tl.doc)[0].key;
    const fragment = slideFragment(slidesMap(tl.doc).get(key)!, BODY_FIELD);
    expect(fragmentToHtml(fragment, schemaFor(BODY_FIELD.options))).toBe('<p>One <em>small</em> step.</p>');
  });

  it('leaves the mirror untouched when nothing has been edited', () => {
    const tl = new TimelineDoc();
    tl.load(timelineWith('<p>Headline</p>', '<p>Body.</p>'));
    tl.flushMirrors();
    expect(tl.events[0].text).toEqual({ headline: '<p>Headline</p>', text: '<p>Body.</p>' });
  });
});

describe('editing a fragment updates the mirror', () => {
  it('follows a direct fragment edit', () => {
    const tl = new TimelineDoc();
    tl.load(timelineWith('<p>Headline</p>', '<p>One small step.</p>'));
    const key = listSlides(tl.doc)[0].key;
    const fragment = slideFragment(slidesMap(tl.doc).get(key)!, BODY_FIELD);

    const paragraph = fragment.get(0) as Y.XmlElement;
    (paragraph.get(0) as Y.XmlText).insert(0, 'That is ');
    tl.flushMirrors();

    expect(tl.events[0].text?.text).toBe('<p>That is One small step.</p>');
  });

  it('flushes on its own without being asked', async () => {
    const tl = new TimelineDoc();
    tl.load(timelineWith('<p>H</p>', '<p>Body.</p>'));
    const key = listSlides(tl.doc)[0].key;
    const fragment = slideFragment(slidesMap(tl.doc).get(key)!, BODY_FIELD);
    ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'New ');

    await Promise.resolve();
    expect(tl.events[0].text?.text).toBe('<p>New Body.</p>');
  });

  it('is flushed before the document is read as a timeline', () => {
    const tl = new TimelineDoc();
    tl.load(timelineWith('<p>H</p>', '<p>Body.</p>'));
    const key = listSlides(tl.doc)[0].key;
    const fragment = slideFragment(slidesMap(tl.doc).get(key)!, BODY_FIELD);
    ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Saved ');

    // No explicit flush: publishing must not be able to ship a stale mirror.
    expect(tl.toTimeline().events[0].text?.text).toBe('<p>Saved Body.</p>');
  });
});

describe('the case an editor-derived mirror would get wrong', () => {
  it('matches the merge when two authors edit one paragraph', () => {
    // Each client would have computed the mirror from its own view and written
    // it to the same string key, so last-write-wins would leave the published
    // paragraph disagreeing with the merged fragment both editors display.
    const a = new TimelineDoc();
    a.load(timelineWith('<p>H</p>', '<p>One small step.</p>'));

    const b = new TimelineDoc();
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));

    const fragOf = (tl: TimelineDoc) =>
      slideFragment(slidesMap(tl.doc).get(listSlides(tl.doc)[0].key)!, BODY_FIELD);

    const aText = (fragOf(a).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    aText.insert(0, 'That is ');
    const bText = (fragOf(b).get(0) as Y.XmlElement).get(0) as Y.XmlText;
    bText.insert(bText.length, ' For a man.');

    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    a.flushMirrors();
    b.flushMirrors();

    const html = a.toTimeline().events[0].text?.text;
    expect(b.toTimeline().events[0].text?.text).toBe(html);
    expect(html).toBe(fragmentToHtml(fragOf(a), schemaFor(BODY_FIELD.options)));
    expect(html).toContain('That is ');
    expect(html).toContain('For a man.');
  });
});

describe('mirror writes do not feed back', () => {
  it('settles rather than looping', async () => {
    const tl = new TimelineDoc();
    tl.load(timelineWith('<p>H</p>', '<p>Body.</p>'));
    const key = listSlides(tl.doc)[0].key;
    const fragment = slideFragment(slidesMap(tl.doc).get(key)!, BODY_FIELD);

    let updates = 0;
    tl.doc.on('update', () => { updates += 1; });
    ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'X');
    await Promise.resolve();
    await Promise.resolve();

    // One update for the edit, one for the mirror write. Not a third.
    expect(updates).toBe(2);
  });
});
