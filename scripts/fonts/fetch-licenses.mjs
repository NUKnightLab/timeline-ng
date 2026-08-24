#!/usr/bin/env node
/**
 * Fetch the upstream licence for every family we mirror.
 *
 * The woff2 files in the fonts directory are byte-for-byte copies of what
 * fonts.gstatic.com serves — committing them to this repo is redistribution,
 * and both licences Google Fonts uses require it to be accompanied by the
 * licence text and copyright notice. The SIL Open Font Licence is explicit:
 * copies of the font, modified or not, must include the licence in full.
 *
 * Licence is determined by which directory a family lives in upstream:
 *   google/fonts/ofl/<slug>/OFL.txt        SIL Open Font Licence 1.1
 *   google/fonts/apache/<slug>/LICENSE.txt Apache 2.0
 *   google/fonts/ufl/<slug>/UFL.txt        Ubuntu Font Licence 1.0
 *
 * Writes one licence file per family under <fontsDir>/LICENSES/ plus an
 * index, and prints any family it could not resolve — an unresolved family
 * must not ship.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const FONTS = resolve(REPO, process.argv[2] ?? 'packages/embed/public/fonts');
const OUT = join(FONTS, 'LICENSES');

const RAW = 'https://raw.githubusercontent.com/google/fonts/main';
const KINDS = [
  ['ofl', 'OFL.txt', 'SIL Open Font License 1.1'],
  ['apache', 'LICENSE.txt', 'Apache License 2.0'],
  ['ufl', 'UFL.txt', 'Ubuntu Font License 1.0'],
];

const manifest = JSON.parse(readFileSync(resolve(HERE, 'manifest.json'), 'utf8'));
const families = [...new Set(Object.values(manifest.sets).flatMap(s => Object.keys(s.families)))].sort();

/** Upstream directory names are the family lowercased with everything stripped. */
const slug = f => f.toLowerCase().replace(/[^a-z0-9]/g, '');

mkdirSync(OUT, { recursive: true });

const index = [];
const unresolved = [];

for (const family of families) {
  let found = null;
  for (const [dir, file, name] of KINDS) {
    const res = await fetch(`${RAW}/${dir}/${slug(family)}/${file}`);
    if (!res.ok) continue;
    found = { name, text: await res.text() };
    break;
  }

  if (!found) {
    unresolved.push(family);
    continue;
  }

  writeFileSync(join(OUT, `${slug(family)}.txt`), found.text);
  const copyright = /Copyright.*/i.exec(found.text)?.[0]?.trim() ?? '';
  index.push({ family, license: found.name, file: `${slug(family)}.txt`, copyright });
  console.log(`  ${family.padEnd(22)} ${found.name}`);
}

const lines = index.map(e => `${e.family}\n  ${e.license}\n  ${e.copyright}\n  LICENSES/${e.file}`);
writeFileSync(
  join(OUT, 'README.txt'),
  `Fonts mirrored from fonts.gstatic.com, byte-for-byte, by\n` +
    `scripts/fonts/fetch-fonts.mjs. Each family's upstream licence follows.\n\n` +
    lines.join('\n\n') + '\n',
);
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');

console.log(`\n${index.length} licences written to ${OUT}`);
if (unresolved.length) {
  console.error(`\nUNRESOLVED — do not ship these families:\n  ${unresolved.join('\n  ')}`);
  process.exit(1);
}
