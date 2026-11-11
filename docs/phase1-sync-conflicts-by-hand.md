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
timelines* → *Published*, open **Space race**. That mints a local draft
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

Open the draft from *Drafts*.

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

## 4a · Seeing what a merge brought in

Set up a merge with no collision: edit one slide in the app, then move a
*different* one from the other browser.

```bash
node scripts/other-browser.mjs edit hubble "Hubble launched — 1990"
```

Reopen the draft. It merges without asking, as before, but the note now names
what landed: *"2 changes published from another browser: Hubble launched and
Voyager 1. They are in this timeline now, alongside your own unpublished
changes."* **See what changed** opens the panel in its incoming mode — the
same comparison as §5a, with *Published* and *Mine, before* as its two sides,
and **Keep mine** on each row and each field.

- Keep one of yours, then **Cmd-Z**. The merge itself is not undoable —
  `adopt` clears the undo stack — but keeping yours is an ordinary edit, so
  undo reaches it and the row returns.
- A fast-forward (no local edits, §3) shows the same list with no buttons:
  nothing of yours was at risk, so there is nothing to keep.

## 5 · Keep both

Set up a collision as in §3, and this time choose **Keep both**. It asks when,
not whether: **Sort it out now** opens the pull-list of §5a straight away,
**Leave it for later** returns to the editor.

Take *later* here. The editor holds the published version; the banner says
*"Your edits are kept as an unmerged draft, listed on the home screen under
this timeline."*

On Home it sits indented under the timeline, labelled *"Unmerged draft"* and
*"not merged yet"*. Deleting it there warns that nothing in it was ever merged
into the timeline above, so those edits go for good.

Open it: a line that cannot be dismissed names the timeline it came from and
says it can never be published from there. **Go sort it out** opens that
timeline with the panel already up. Publish is disabled — an unmerged draft
holds no claim on a record.

## 5a · Sorting out the differences

Still in the published-backed timeline, with the draft from §5 unmerged: a
line under the subnav says you have an unmerged draft of this timeline.
**Sort it out**. (*Sort it out now* at the conflict lands in the same panel
without the detour.)

The panel is centered and wide. Its two sides are **Published** — what you are
editing, and what the public link shows — and **My draft**, the edits that
never landed. Each row names both in a sentence, and names what it is about
rather than saying "this": *"You changed this slide."*, *"You deleted this
slide; the published timeline still has it."*, *"You changed the settings."* A
row the published timeline also changed warns that keeping yours replaces
that.

An edited row shows the comparison under it: one line per field that differs,
both values side by side under *Published* / *My draft*. Long values —
a body paragraph — stack instead of sitting in columns, and carry those two
labels with them, since a stacked pair has left the columns that explained
it. The settings row names
the settings it is offering (Theme, Fonts, Share image) rather than being a
row with no content at all.

Every row has both ways out:

- **Keep mine** or **Keep published** on one line, and the row stays but
  shrinks — that line drops off and the rest is still on offer. When the last
  line goes, so does the row. Answer two lines different ways to see that
  neither reaches the other.
- **Keep all of mine** / **Keep all published** (or **Keep mine — add the
  slide** / **— delete the slide**) answer every line still showing, which is
  all they can ever reach.
- **Cmd-Z** undoes keeping yours. The row comes back: the list is recomputed
  rather than ticked off, so there is nothing to get out of step.
- Keeping published does not come back, the draft itself is untouched, and —
  unlike keeping yours — Cmd-Z does not undo it. Reload to confirm it stays
  settled: the decision is written into the recorded ancestor, not held in the
  page.
- Only fields **your draft** changed are lines. Edit a slide in the other
  browser that your draft never touched, and it does not appear as something
  to keep — there is nothing of yours to keep there.
- **Open my draft instead** goes there to read it, for anything the panel
  could not offer.

Settle every row and the panel says so, offering to delete the draft. Close it
first and the subnav line says it too, in grey, with **Delete it** — the editor
reads the draft to decide this, so a draft that has been sorted out never
claims to be outstanding.

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
