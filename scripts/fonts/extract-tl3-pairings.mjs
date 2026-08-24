#!/usr/bin/env node
/**
 * Extract TimelineJS 3's font pairings and re-resolve them against the modern
 * Google Fonts API.
 *
 * TL3's pairings are good, familiar design choices worth carrying forward. Its
 * font *stylesheets* are not: they were generated before woff2 and before
 * unicode-range subsetting, so each one hotlinks whole TrueType files. PT Sans
 * regular is 265 KB as TL3 serves it and 11 KB as a modern woff2 slice.
 *
 * This script reads each TL3 set, recovers the pairing (which family is the
 * headline, which is the body, at what size and weight, with what fallback
 * stack), then asks the Google CSS v2 API — with a modern User-Agent, which is
 * what makes it answer in woff2 — for every unicode-range slice of the weights
 * we actually use.
 *
 * Nothing is restricted to Latin. Every slice a family offers is recorded, and
 * the browser fetches only the ones a given timeline's text needs; a Cyrillic
 * timeline pulls the Cyrillic slice and never touches Latin.
 *
 * Writes:
 *   scripts/fonts/manifest.json         every family, weight, slice and URL
 *   packages/core/src/fonts.ts          pairing metadata for player + authoring
 *
 * Downloading the actual files is a separate step — see fetch-fonts.mjs.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const TL3 = 'https://cdn.knightlab.com/libs/timeline3/latest/css/fonts';
/* The API serves TrueType to unrecognised clients; this is what unlocks woff2. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/*
 * From the TimelineJS3 repo tree. `base` is a shared partial, not a pairing.
 *
 * `default` is omitted deliberately: font.default.css and font.pt.css are the
 * same stylesheet apart from a comment header, so TL3's "default" is an alias
 * for "pt". It is carried as an alias in generate-pairings.mjs rather than a
 * second entry — offering the same two faces twice is confusing, and the name
 * is worse than redundant in this codebase, where `fontPairing: 'default'`
 * would read as "the default" while meaning PT Sans Narrow + PT Serif.
 */
const SETS = [
  'georgia-helvetica', 'pt', 'ubuntu', 'oldstandard',
  'abril-droidsans', 'amatic-andika', 'bevan-pontanosans', 'bitter-raleway',
  'clicker-garamond', 'dancing-ledger', 'fjalla-average', 'lustria-lato',
  'medula-lato', 'opensans-gentiumbook', 'playfair', 'playfair-faunaone',
  'roboto-megrim', 'rufina-sintony', 'unicaone-vollkorn', 'knightlab',
];

// ── tiny CSS helpers ────────────────────────────────────────────────────────

/** Body of the first rule whose selector list contains `selector` exactly. */
function ruleBody(css, selector) {
  const re = new RegExp(
    `(^|})([^{}]*(?:^|,)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:,|\\{))`,
    'm',
  );
  const m = re.exec(css);
  if (!m) return null;
  const open = css.indexOf('{', m.index + m[1].length);
  const close = css.indexOf('}', open);
  return open === -1 || close === -1 ? null : css.slice(open + 1, close);
}

const decl = (body, prop) => {
  if (!body) return null;
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(body);
  return m ? m[1].trim().replace(/\s*!important$/, '') : null;
};

/** Split a font stack into its first family and the rest, unquoted. */
function splitStack(stack) {
  if (!stack) return { family: null, fallback: [] };
  const parts = stack.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  return { family: parts[0] ?? null, fallback: parts.slice(1) };
}

// ── Google Fonts resolution ─────────────────────────────────────────────────

async function googleCss(spec) {
  const url = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  return res.ok ? res.text() : null;
}

/**
 * Ask for the weights the player actually renders, degrading when a family
 * doesn't publish them. Many display faces ship a single weight, and the API
 * 400s on the whole request if any one weight is missing.
 */
async function resolveFamily(family, wantItalic) {
  const name = family.replace(/ /g, '+');
  const attempts = wantItalic
    ? [`${name}:ital,wght@0,400;0,700;1,400`, `${name}:wght@400;700`, `${name}:wght@400`, name]
    : [`${name}:wght@400;700`, `${name}:wght@400`, name];

  for (const spec of attempts) {
    const css = await googleCss(spec);
    if (!css) continue;

    const faces = [];
    /* Each block is one script slice; the /* comment *\/ above it names it. */
    const re = /\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi;
    let m;
    while ((m = re.exec(css))) {
      const [, script, block] = m;
      const url = /url\((https:[^)]+)\)/.exec(block)?.[1];
      if (!url) continue;
      faces.push({
        script,
        url,
        weight: Number(decl(block, 'font-weight') ?? 400),
        style: decl(block, 'font-style') ?? 'normal',
        unicodeRange: decl(block, 'unicode-range'),
      });
    }
    if (faces.length) return { spec, faces };
  }
  return null;
}

// ── main ────────────────────────────────────────────────────────────────────

const pairings = [];
const manifest = { generatedAt: new Date().toISOString().slice(0, 10), source: TL3, sets: {} };

for (const id of SETS) {
  const res = await fetch(`${TL3}/font.${id}.css`);
  if (!res.ok) {
    console.warn(`  skip ${id} — HTTP ${res.status}`);
    continue;
  }
  const css = await res.text();

  const bodyRule = ruleBody(css, '.tl-timeline');
  const headRule = ruleBody(css, '.tl-timeline h1');

  const body = splitStack(decl(bodyRule, 'font-family'));
  const head = splitStack(decl(headRule, 'font-family'));
  if (!body.family || !head.family) {
    console.warn(`  skip ${id} — no font-family mapping found`);
    continue;
  }

  /* A family is web-loaded only if this set declares an @font-face for it. */
  const declared = new Set(
    [...css.matchAll(/@font-face\s*\{[^}]*font-family:\s*['"]([^'"]+)['"]/gi)].map(m => m[1]),
  );

  const families = {};
  for (const [role, f] of [['body', body.family], ['heading', head.family]]) {
    if (!declared.has(f)) continue;               // system font — nothing to fetch
    if (families[f]) continue;                    // same family in both roles
    const resolved = await resolveFamily(f, role === 'body');
    if (!resolved) {
      console.warn(`  ${id}: could not resolve "${f}" on Google Fonts`);
      continue;
    }
    families[f] = resolved;
  }

  const scriptsPerFamily = Object.values(families).map(v => new Set(v.faces.map(f => f.script)));
  /* Guaranteed coverage is the intersection: a script needs both faces to
     render consistently. A pairing with no web fonts inherits the system's
     coverage, which is universal. */
  const scripts = scriptsPerFamily.length
    ? [...scriptsPerFamily.reduce((a, b) => new Set([...a].filter(s => b.has(s))))].sort()
    : ['system'];

  const bytes = Object.values(families).flatMap(v => v.faces).length;

  manifest.sets[id] = {
    body: { ...body, webfont: declared.has(body.family) },
    heading: { ...head, webfont: declared.has(head.family) },
    families,
    scripts,
  };

  pairings.push({
    id,
    heading: head,
    body: body,
    scripts,
    headingTransform: decl(headRule, 'text-transform') ?? 'none',
    headingWeight: Number(decl(headRule, 'font-weight') ?? 700),
    headingPx: parseFloat(decl(headRule, 'font-size') ?? '0') || null,
    bodyPx: parseFloat(decl(bodyRule, 'font-size') ?? '0') || null,
    bodyLineHeight: decl(bodyRule, 'line-height'),
    webfontFaces: bytes,
  });

  console.log(
    `  ${id.padEnd(22)} ${head.family} / ${body.family}` +
      `  ${bytes} slices  [${scripts.join(' ')}]`,
  );
}

mkdirSync(HERE, { recursive: true });
writeFileSync(resolve(HERE, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nmanifest.json — ${Object.keys(manifest.sets).length} sets`);

writeFileSync(resolve(HERE, 'pairings.raw.json'), JSON.stringify(pairings, null, 2) + '\n');
console.log(`pairings.raw.json — ${pairings.length} pairings`);
