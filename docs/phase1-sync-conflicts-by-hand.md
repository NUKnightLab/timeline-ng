# Stage 5c by hand

The scripts in [phase1-sync-conflicts.md](phase1-sync-conflicts.md) as a
sequence you can actually drive. Needs devnet up (`bash scripts/devnet-up.sh`), `pnpm authoring:devnet` on
http://127.0.0.1:5173, and
`node scripts/other-browser.mjs seed`, which writes the record this walks
through — *Space race*, three slides (`apollo` 1969, `voyager` 1977,
`hubble` 1990).

`scripts/other-browser.mjs` **is** the other browser. It writes to alice's repo with no
`swapRecord`, which is exactly what a second browser does: it moves the record
while this browser's draft is not looking. Every command prints the CID before
and after, because the CID is the entire detection mechanism — if it did not
move, the app is right to stay silent.

```bash
node scripts/other-browser.mjs show
```

Run from the repo root. Subcommands: `show`, `seed`, `edit <slide> <headline>`,
`add <id> <year> <headline>`, `remove <slide>`, `theme <name>`, `reset`.

**Start:** sign in as `alice.devnet.test` / `alice-devnet-pass`. Under *Your
timelines* → *In your account*, open **Space race**. That mints a local draft
carrying the record's URI and its base CID. Go back Home — the comparison runs
on open, so returning Home and reopening is the gesture that triggers it.

**Between scenarios:** delete the local draft from its Home row, re-run `seed`,
and open the record again. (`seed` restores the three slides but mints a new
CID, so an old draft would see it as moved.)

---

## 1 · The quiet one — the record moved, nothing of yours is at risk

Make no local edits. Then:

```bash
node scripts/other-browser.mjs edit voyager "Voyager 1 — interstellar"
```

Open the draft from *In this browser*.

Expect slide 2 to read the new headline, and a banner under the subnav:
*"Updated to the version published from another device."* No dialog, no choice.

## 2 · Merged without asking — the case that proves the granularity

Open the draft, change **apollo**'s headline (say *Apollo 11 — July 1969*).
Don't publish. Back Home. Then:

```bash
node scripts/other-browser.mjs add pioneer 1972 "Pioneer 10"
```

Reopen the draft. Your apollo edit is still there, Pioneer 10 has appeared, and
the banner reads *"Merged 1 change published from another device. Publish again
to include your own."* Both sides moved and still nobody was asked anything.

Publish to settle it, then `show` to see both changes in the record.

## 3 · The choice, caught at open

Open the draft, change **voyager**'s headline locally. Don't publish. Back Home.

```bash
node scripts/other-browser.mjs edit voyager "Voyager 1 — 45 years out"
```

Reopen. Now the dialog: *"This timeline changed in your account"*, three options
each carrying its own cost, and underneath *"Both versions changed 1 slide,
which is why this cannot be merged for you."*

Press **Escape** first. Nothing happens to the draft, and reopening asks again —
deliberate: dismissing must not quietly leave a fork behind.

## 4 · The choice, interrupting a publish

Reopen and get past the dialog with **Keep mine**. Edit **apollo** locally. Then,
*while you are still in the editor*:

```bash
node scripts/other-browser.mjs edit apollo "Apollo 11 — the landing"
```

Hit **Publish**. The PDS refuses the swap and the same choice appears, worded for
the moment: *"Publishing now would replace newer changes"* / *"It was published
from another device while you were editing."*

**Keep mine** here publishes again against the new CID — the one deliberate
overwrite path in the whole design. `show` afterwards: your headline won, and the
other device's is gone. That is the bug this stage closed, now only reachable on
purpose.

## 5 · Keep both, and where it stops

Set up a collision as in §3, and this time choose **Keep both**.

The editor holds the published version; the banner says *"Your edits are kept as
a separate copy, listed on the home screen under this timeline."* On Home the
fork sits indented under the timeline, labelled *"Your edits, kept aside"*.

Open the fork: *"This is a copy kept aside from a timeline in your account. It
publishes nowhere until you bring its changes back into that one."* Publish is
disabled — a fork holds no claim on a record.

**This is the edge of what shipped.** The fork can be opened and read; it cannot
yet be reconciled. The pull-list is what turns that from a deferral into a
resolution.

## 6 · The record deleted elsewhere (cheap, if you're curious)

```bash
node scripts/other-browser.mjs reset
```

Open the draft: *"This timeline is no longer in your account. Publishing will put
it back."* Nothing is deleted locally.

---

## Still unsettled

- **§1 vs §3** — is the quiet case quiet enough that the loud one reads as
  genuinely different, rather than as more of the same noise?
- **§3's cost lines** — do they answer *what do I lose* fast enough that nobody
  reaches for a diff? That is the bet the dialog makes.
- **§4** — the status span replaces the Publish button while it is up, so a
  refusal sits where the control to act on it used to be. Amber and wrapping
  now, but still the weakest spot in the layout.
- **§5's fork row** — reads as something to come back to, or as clutter?

Settled by walking it through on 2026-11-03: "another device" became "another
browser", which is both truer (a browser profile is the unit of isolation — the
draft lives in its IndexedDB) and plainer. The fast-forward banner should also
say *what* changed rather than where it came from; the analysis needed for that
is already computed and currently discarded on that path.
