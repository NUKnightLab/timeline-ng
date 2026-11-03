/**
 * "The other browser" — for hand-testing Stage 5c (local draft vs published
 * record) against the devnet PDS. See docs/phase1-sync-conflicts-by-hand.md.
 *
 * Writes to alice's repo with no `swapRecord`, which is exactly what a second
 * browser does: it moves the record while this browser's draft is not looking.
 * Every subcommand prints the CID before and after, because the CID is the
 * whole detection mechanism — if it did not move, the app is right to stay
 * quiet.
 *
 *   node scripts/other-browser.mjs show
 *   node scripts/other-browser.mjs seed
 *   node scripts/other-browser.mjs edit voyager "Voyager 1 — interstellar"
 *   node scripts/other-browser.mjs add pioneer 1972 "Pioneer 10"
 *   node scripts/other-browser.mjs remove hubble
 *   node scripts/other-browser.mjs theme dark
 *   node scripts/other-browser.mjs reset
 *
 * Devnet only, and it hardcodes the seeded account: see docs/atproto-devnet.md.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// @atproto/api is a dependency of packages/authoring, not of the root, so it
// is resolved from there rather than from this script's own directory.
const require = createRequire(new URL('../packages/authoring/package.json', import.meta.url));
const { AtpAgent } = await import(pathToFileURL(require.resolve('@atproto/api')).href);

const COLLECTION = 'com.knightlab.timeline';
const RKEY = 'uxdemo';

const agent = new AtpAgent({ service: 'http://localhost:3001' });
await agent.login({ identifier: 'alice.devnet.test', password: 'alice-devnet-pass' });
const repo = agent.assertDid;

const [cmd, ...args] = process.argv.slice(2);

const slide = (unique_id, year, headline, text) => ({
  unique_id,
  start_date: { year },
  text: { headline, ...(text ? { text: `<p>${text}</p>` } : {}) },
});

async function read() {
  try {
    const got = await agent.com.atproto.repo.getRecord({ repo, collection: COLLECTION, rkey: RKEY });
    return { cid: got.data.cid, value: got.data.value };
  } catch {
    return null;
  }
}

async function write(value, wasCid) {
  value.createdAt = new Date().toISOString();
  const r = await agent.com.atproto.repo.putRecord({ repo, collection: COLLECTION, rkey: RKEY, record: value });
  console.log(`  was ${wasCid ?? '(new)'}\n  now ${r.data.cid}`);
  return r.data.cid;
}

function describe(value, cid) {
  console.log(`at://${repo}/${COLLECTION}/${RKEY}`);
  console.log(`cid   ${cid}`);
  console.log(`title ${JSON.stringify(value.title)}`);
  for (const e of value.timeline?.events ?? []) {
    console.log(`  ${e.unique_id.padEnd(10)} ${e.start_date?.year}  ${JSON.stringify(e.text?.headline)}`);
  }
  console.log(`  settings  ${JSON.stringify(value.timeline?.settings ?? {})}`);
}

if (cmd === 'seed') {
  const existing = await read();
  const record = {
    $type: COLLECTION,
    title: 'Space race',
    timeline: {
      events: [
        slide('apollo', 1969, 'Apollo 11', 'One small step.'),
        slide('voyager', 1977, 'Voyager 1', 'Still going.'),
        slide('hubble', 1990, 'Hubble launched', 'A new eye.'),
      ],
      settings: { language: 'en', theme: 'auto', initialIndex: 0, reverseOrder: false },
    },
  };
  console.log('seeded:');
  const cid = await write(record, existing?.cid);
  console.log();
  describe(record, cid);
} else if (cmd === 'show') {
  const cur = await read();
  if (!cur) { console.log('no record — run `seed`'); process.exit(1); }
  describe(cur.value, cur.cid);
} else if (cmd === 'reset') {
  await agent.com.atproto.repo.deleteRecord({ repo, collection: COLLECTION, rkey: RKEY });
  console.log('deleted', RKEY);
} else {
  const cur = await read();
  if (!cur) { console.log('no record — run `seed` first'); process.exit(1); }
  const next = structuredClone(cur.value);
  const events = next.timeline.events;

  if (cmd === 'edit') {
    const [id, ...rest] = args;
    const ev = events.find((e) => e.unique_id === id);
    if (!ev) { console.log(`no slide ${id}`); process.exit(1); }
    ev.text.headline = rest.join(' ');
    console.log(`edited ${id} → ${JSON.stringify(ev.text.headline)}`);
  } else if (cmd === 'add') {
    const [id, year, ...rest] = args;
    events.push(slide(id, Number(year), rest.join(' ')));
    console.log(`added ${id}`);
  } else if (cmd === 'remove') {
    const [id] = args;
    const i = events.findIndex((e) => e.unique_id === id);
    if (i < 0) { console.log(`no slide ${id}`); process.exit(1); }
    events.splice(i, 1);
    console.log(`removed ${id}`);
  } else if (cmd === 'theme') {
    next.timeline.settings = { ...next.timeline.settings, theme: args[0] };
    console.log(`theme → ${args[0]}`);
  } else {
    console.log('subcommands: show seed edit add remove theme reset');
    process.exit(1);
  }
  await write(next, cur.cid);
}
