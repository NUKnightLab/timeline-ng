/**
 * Body-copy styling has exactly one definition.
 *
 * It drifted three times running — blockquote, then lists, then headings and
 * code — because the player's slide body and the editor's content area each
 * carried their own copy of the same rules, and only one got fixed each time.
 * `prose.css` is now the single definition and both apply `.tl-prose`.
 *
 * This test exists to make a fourth drift fail loudly rather than quietly look
 * wrong in one of the two places.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const prose = read('../../../player/src/styles/prose.css');
const slideContent = read('../../../player/src/components/SlideContent.svelte');
const richText = read('../components/RichTextEditor.svelte');

/** Elements an author can produce that prose.css is responsible for. */
const OWNED = ['p', 'a', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'code', 'pre', 'hr'];

const styleBlock = (svelte: string) => svelte.slice(svelte.lastIndexOf('<style>'));

describe('prose.css owns body-copy styling', () => {
  it.each(OWNED)('defines rules for %s', (el) => {
    expect(prose).toMatch(new RegExp(`\\.tl-prose\\.tl-prose :where\\(${el}[):]`));
  });

  it('is applied by the player', () => {
    expect(slideContent).toContain('tl-prose');
    expect(slideContent).toContain("import '../styles/prose.css'");
  });

  it('is applied by the editor', () => {
    expect(richText).toContain("'@knight-lab/timeline-ng/prose.css'");
    expect(richText).toContain('tl-prose');
  });

  it.each(OWNED)('is not restated for %s by the player', (el) => {
    expect(styleBlock(slideContent)).not.toMatch(new RegExp(`tl-slide__body :global\\(${el}[):]`));
  });

  /*
   * Every element that carries a prose class, not just the editable one. The
   * read-only panels restated paragraph, heading, list and link rules of their
   * own, which beat prose.css on specificity and drifted from it — the same
   * failure as the player/editor split, one level in.
   */
  const PROSE_CONTAINERS = ['rte-content', 'slide-body-text', 'slide-h'];

  it.each(
    PROSE_CONTAINERS.flatMap((container) => OWNED.map((el) => [container, el] as const)),
  )('%s does not restate a rule for %s', (container, el) => {
    // Both files' style blocks — concatenating the *files* first would slice
    // from the last <style> and silently inspect only one of them.
    const rules = [styleBlock(richText), styleBlock(read('../components/EventEditor.svelte'))]
      .join('\n')
      .split('\n')
      .filter((l) => !l.includes('--singleline') && !l.includes(':not(.tl-prose)'));
    expect(rules.join('\n')).not.toMatch(new RegExp(`\\.${container} :global\\(${el}[):]`));
  });

  it.each(OWNED)('is not restated for %s by the editor', (el) => {
    // `.rte-content--singleline` is exempt: the headline field is a one-line
    // form control, not a prose block, and deliberately opts out of .tl-prose.
    const rules = styleBlock(richText)
      .split('\n')
      .filter((l) => !l.includes('--singleline') && !l.includes(':not(.tl-prose)'));
    expect(rules.join('\n')).not.toMatch(new RegExp(`\\.rte-content ${el}[\\s{,:]`));
  });
});

describe('every place the app renders authored HTML is protected', () => {
  // The bug this catches: `prose.css` reached the editor but not the read-only
  // panels beside it, so a blockquote was styled by the design system there —
  // serif, bold, oversized, with decorative quote glyphs. Anywhere authored
  // markup is printed needs the reset, whether or not it is editable.
  const componentDir = fileURLToPath(new URL('../components/', import.meta.url));
  const components = readdirSync(componentDir).filter((f) => f.endsWith('.svelte'));

  /*
   * Not every `{@html}` renders authored prose. Third-party embed markup —
   * an oEmbed response, a pasted iframe — brings its own layout, and the prose
   * reset would strip it. Exemptions are listed by the function that produced
   * the HTML, so adding one is a deliberate act rather than a weakened test.
   */
  const NOT_PROSE = ['sanitizeEmbedHtml'];

  const lines = components.flatMap((file) =>
    readFileSync(componentDir + file, 'utf8')
      .split('\n')
      .map((text, i) => ({ file, line: i + 1, text }))
      .filter((l) => l.text.includes('{@html'))
      .filter((l) => !NOT_PROSE.some((fn) => l.text.includes(fn))),
  );

  it('finds the places that render authored HTML', () => {
    expect(lines.length).toBeGreaterThan(0);
  });

  it.each(lines.map((l) => [`${l.file}:${l.line}`, l.text]))('%s carries a prose class', (_where, text) => {
    expect(text).toMatch(/tl-prose(-inline)?\b/);
  });
});
