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
import { readFileSync } from 'node:fs';
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

  it.each(OWNED)('is not restated for %s by the editor', (el) => {
    // `.rte-content--singleline` is exempt: the headline field is a one-line
    // form control, not a prose block, and deliberately opts out of .tl-prose.
    const rules = styleBlock(richText)
      .split('\n')
      .filter((l) => !l.includes('--singleline') && !l.includes(':not(.tl-prose)'));
    expect(rules.join('\n')).not.toMatch(new RegExp(`\\.rte-content ${el}[\\s{,:]`));
  });
});
