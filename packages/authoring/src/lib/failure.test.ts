/**
 * @vitest-environment happy-dom
 *
 * Failure paths. Everything else in this suite asserts that the happy path
 * works; these assert what happens when it does not, because the modes that
 * matter here are quiet ones — content that vanishes without an error.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { TimelineDoc } from './doc.svelte.ts';
import {
  RICH_TEXT_FIELDS, addSlide, createDoc, ensureFragments, listSlides, readSlide, slideFragment,
  slidesMap, writeSlide,
} from './doc.ts';
import { fragmentToHtml, htmlToFragment, schemaFor } from './richtext.ts';

const BODY = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'text')!;
const HEADLINE = RICH_TEXT_FIELDS.find((f) => f.mirrorField === 'headline')!;

describe('reading a fragment with the wrong schema', () => {
  it('drops the unknown node AND its text, with no error', () => {
    // Measured, and the reason RICH_TEXT_FIELDS is the single place the
    // field -> configuration mapping lives. A missed migration is quiet and
    // lossy, not loud: nothing throws and the words are simply gone.
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('f');
    htmlToFragment('<blockquote><p>Quoted.</p></blockquote><p>After.</p>', schemaFor(BODY.options), fragment);

    expect(fragmentToHtml(fragment, schemaFor(HEADLINE.options))).toBe('<p>After.</p>');
  });

  it('by contrast, parsing the same markup keeps the text', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('f');
    htmlToFragment('<blockquote><p>Quoted.</p></blockquote>', schemaFor(HEADLINE.options), fragment);
    expect(fragmentToHtml(fragment, schemaFor(HEADLINE.options))).toBe('<p>Quoted.</p>');
  });
});

describe('prose that cannot be turned into a fragment', () => {
  it('keeps the text rather than losing it, by declining to make a fragment', () => {
    // Yjs does not roll back a transaction whose callback throws, so a slide
    // that cannot be seeded must leave the document in the state it was in
    // rather than half-built. That field degrades to plain HTML.
    const doc = createDoc();
    const key = addSlide(doc, { unique_id: 'x', text: { headline: 'H', text: '<p>Body.</p>' } });
    const slide = slidesMap(doc).get(key)!;

    // A fragment whose content the schema cannot represent at all.
    slide.delete(BODY.fragmentKey);
    const text = slide.get('text') as Y.Map<unknown>;
    text.set('text', '<figure><figcaption>Unrepresentable</figcaption></figure>');

    expect(() => ensureFragments(slide)).not.toThrow();
    expect(readSlide(slide).text?.text).toBe('<figure><figcaption>Unrepresentable</figcaption></figure>');
  });

  it('hostile markup does not survive into the fragment', () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('f');
    htmlToFragment('<p onclick="steal()">Hello<script>steal()<\/script></p>', schemaFor(BODY.options), fragment);
    const html = fragmentToHtml(fragment, schemaFor(BODY.options));
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('Hello');
  });
});

describe('a mirror flush racing a deletion', () => {
  it('skips a fragment whose slide has gone', () => {
    const t = new TimelineDoc();
    t.load({ events: [{ unique_id: 'doomed', text: { headline: 'H', text: '<p>Body.</p>' } }], settings: {} });
    const key = listSlides(t.doc)[0].key;
    const fragment = slideFragment(slidesMap(t.doc).get(key)!, BODY);

    // Edit and delete in the same tick, before the queued flush can run.
    ((fragment.get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Edited ');
    t.removeEvent('doomed');

    expect(() => t.flushMirrors()).not.toThrow();
    expect(t.events).toEqual([]);
  });
});

describe('writeSlide against a slide whose fragments failed to build', () => {
  it('still owns the HTML, so the field keeps working', () => {
    const doc = createDoc();
    const key = addSlide(doc, { unique_id: 'x', text: { headline: 'H', text: '<p>Body.</p>' } });
    const slide = slidesMap(doc).get(key)!;
    slide.delete(BODY.fragmentKey);

    writeSlide(slide, { unique_id: 'x', text: { headline: 'H', text: '<p>Edited.</p>' } });
    expect(readSlide(slide).text?.text).toBe('<p>Edited.</p>');
  });
});
