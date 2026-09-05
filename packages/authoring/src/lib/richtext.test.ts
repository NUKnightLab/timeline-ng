/**
 * @vitest-environment happy-dom
 *
 * The rest of the suite runs in node; ProseMirror's HTML parse and serialize
 * need a DOM, so only this file pays for one.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { fragmentToHtml, htmlToFragment, rebuildFragmentFromHtml, schemaFor } from './richtext.ts';

const BODY = {};
const HEADLINE = { inlineOnly: true, noLink: true, singleLine: true };
const CAPTION = { minimal: true };

function roundTrip(html: string, opts = BODY): string {
  const schema = schemaFor(opts);
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('f');
  htmlToFragment(html, schema, fragment);
  return fragmentToHtml(fragment, schema);
}

describe('HTML survives the trip through a Y.XmlFragment', () => {
  it.each([
    ['a paragraph', '<p>One small step.</p>'],
    ['bold and italic', '<p>One <strong>small</strong> <em>step</em>.</p>'],
    ['a link', '<p>See <a target="_blank" rel="noopener" href="https://example.com">this</a>.</p>'],
    ['a heading', '<h2>Apollo 11</h2>'],
    ['a list', '<ul><li><p>Armstrong</p></li><li><p>Aldrin</p></li></ul>'],
    ['a blockquote', '<blockquote><p>Magnificent desolation.</p></blockquote>'],
    ['strikethrough', '<p>Launch <s>Tuesday</s> Wednesday.</p>'],
    ['several paragraphs', '<p>First.</p><p>Second.</p>'],
  ])('%s', (_label, html) => {
    expect(roundTrip(html)).toBe(html);
  });

  it('treats an empty document as an empty string, as the editor does', () => {
    expect(roundTrip('')).toBe('');
  });
});

describe('the schemas differ exactly where they are meant to', () => {
  it('the headline keeps bold, italic and strike', () => {
    expect(roundTrip('<p>A <strong>bold</strong> <em>new</em> <s>old</s> era</p>', HEADLINE))
      .toBe('<p>A <strong>bold</strong> <em>new</em> <s>old</s> era</p>');
  });

  it('the headline drops a link but keeps its text', () => {
    const out = roundTrip('<p>See <a href="https://example.com">this</a>.</p>', HEADLINE);
    expect(out).toBe('<p>See this.</p>');
  });

  it('the headline flattens a heading to a paragraph', () => {
    expect(roundTrip('<h2>Apollo 11</h2>', HEADLINE)).toBe('<p>Apollo 11</p>');
  });

  it('a caption keeps links and inline code', () => {
    const html = '<p>From <a target="_blank" rel="noopener" href="https://nasa.gov">NASA</a> <code>AS11</code></p>';
    expect(roundTrip(html, CAPTION)).toBe(html);
  });

  it('a caption drops block structure', () => {
    expect(roundTrip('<blockquote><p>Quoted.</p></blockquote>', CAPTION)).toBe('<p>Quoted.</p>');
  });
});

describe('rebuilding from HTML', () => {
  it('replaces a fragment rather than appending to it', () => {
    // The migration path: discard the fragment, re-parse the mirror.
    const schema = schemaFor(BODY);
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment('f');
    htmlToFragment('<p>Original.</p>', schema, fragment);
    rebuildFragmentFromHtml('<p>Replaced.</p>', schema, fragment);
    expect(fragmentToHtml(fragment, schema)).toBe('<p>Replaced.</p>');
  });
});

describe('two authors editing one paragraph', () => {
  it('merges rather than one overwriting the other', () => {
    // The entire reason for Y.XmlFragment over an HTML string (§3.2).
    const schema = schemaFor(BODY);
    const a = new Y.Doc();
    htmlToFragment('<p>One small step.</p>', schema, a.getXmlFragment('f'));

    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // A edits the start, B edits the end, neither having seen the other.
    (a.getXmlFragment('f').get(0) as Y.XmlElement).insert(0, [new Y.XmlText('That is ')]);
    const bText = (b.getXmlFragment('f').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    bText.insert(bText.length, ' For a man.');

    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    const merged = fragmentToHtml(a.getXmlFragment('f'), schema);
    expect(merged).toBe(fragmentToHtml(b.getXmlFragment('f'), schema));
    expect(merged).toContain('That is ');
    expect(merged).toContain('For a man.');
  });
});
