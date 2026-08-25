#!/usr/bin/env node
/**
 * Generate the custom-property reference in the authoring docs.
 *
 * The player reads 80-odd `--tl-*` properties, but only about a quarter are
 * declared in base.css; the rest exist solely as inline fallbacks inside
 * component styles. So there is no one file to point a self-hoster at, and a
 * hand-written list would be wrong within a release. This reads the source.
 *
 * Two properties are excluded because the player writes them itself in a style
 * attribute to pass layout measurements around — they are plumbing, not knobs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SRC = resolve(REPO, 'packages/player/src');
const OUT = resolve(REPO, 'packages/authoring/public/docs/custom-properties.html');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(join(dir, e.name))
    : /\.(svelte|css)$/.test(e.name) ? [join(dir, e.name)] : []);
}

/** Read `var(--x, <fallback>)` with balanced parens, which nested var()s need. */
function readFallback(text, from) {
  let depth = 1, i = from;
  while (i < text.length && depth > 0) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    i++;
  }
  return text.slice(from, i - 1).trim();
}

const files = walk(SRC);
const used = new Set();
const fallback = new Map();
const componentDeclared = new Map();
const internal = new Set();

for (const f of files) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(/var\(\s*(--tl-[a-z0-9-]+)\s*(,)?/g)) {
    used.add(m[1]);
    if (m[2] && !fallback.has(m[1])) {
      fallback.set(m[1], readFallback(t, m.index + m[0].length));
    }
  }
  /* Written by the player itself into a style attribute — layout plumbing. */
  for (const m of t.matchAll(/style="[^"]*?(--tl-[a-z0-9-]+):/g)) internal.add(m[1]);

  /*
   * Some properties are declared on the component that uses them rather than
   * in base.css, and then read without a fallback because the declaration is
   * right there — the Bluesky card's colors work this way. Those defaults are
   * real; they were simply invisible to a scan that only looked at base.css
   * and at inline fallbacks.
   */
  for (const block of t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const d of block[1].matchAll(/(--tl-[a-z0-9-]+):\s*([^;]+);/g)) {
      if (!componentDeclared.has(d[1])) componentDeclared.set(d[1], d[2].trim());
    }
  }
}

/* base.css declarations are the real defaults where they exist. */
const base = readFileSync(resolve(SRC, 'styles/base.css'), 'utf8');
const root = base.slice(base.indexOf(':root {'), base.indexOf('@media (prefers-color-scheme: dark)'));
const declared = new Map(
  [...root.matchAll(/(--tl-[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]),
);
const themed = new Set(
  [...base.matchAll(/\[data-tl-theme="dark"\][^}]*}/gs)]
    .flatMap(m => [...m[0].matchAll(/(--tl-[a-z0-9-]+):/g)].map(x => x[1])),
);

const GROUPS = [
  ['Color', t => /^--tl-color-(?!nav)/.test(t)],
  ['Typography', t => /font-|headline|body-|date-|caption/.test(t)],
  ['Slide layout', t => t.startsWith('--tl-slide')],
  ['Timeline navigator', t => /nav/.test(t)],
  ['Media cards', t => /bsky|tiktok|wiki/.test(t)],
  ['Everything else', () => true],
];

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const rows = [];
for (const [name, test] of GROUPS) {
  const tokens = [...used]
    .filter(t => !internal.has(t) && !rows.some(r => r.token === t) && test(t))
    .sort();
  for (const t of tokens) {
    rows.push({
      group: name,
      token: t,
      /* base.css is authoritative; then an inline fallback; then a
         declaration on the component that owns the property. */
      value: declared.get(t) ?? fallback.get(t) ?? componentDeclared.get(t) ?? '',
      themed: themed.has(t),
    });
  }
}

let html = '';
let current = null;
for (const r of rows) {
  if (r.group !== current) {
    if (current) html += '</table>\n\n';
    html += `<h3>${r.group}</h3>\n<table class="field-table token-table">\n` +
            `  <tr><th>Property</th><th>Default</th></tr>\n`;
    current = r.group;
  }
  const dark = r.themed ? ' <span class="tok-themed" title="has a separate dark-mode value">dark</span>' : '';
  html += `  <tr><td><code>${r.token}</code>${dark}</td><td><code>${esc(r.value) || '&mdash;'}</code></td></tr>\n`;
}
html += '</table>';

const page = readFileSync(OUT, 'utf8');
const BEGIN = '<!-- BEGIN GENERATED TOKENS';
const END = '<!-- END GENERATED TOKENS -->';
const from = page.indexOf(BEGIN), to = page.indexOf(END);
if (from === -1 || to === -1) throw new Error('generated-token markers missing in custom-properties.html');
const head = page.slice(0, page.indexOf('\n', from) + 1);
writeFileSync(OUT, head + html + '\n' + page.slice(to));

console.log(`custom-properties.html — ${rows.length} properties, ${new Set(rows.map(r => r.group)).size} groups`);
console.log(`  excluded as internal: ${[...internal].join(', ')}`);
