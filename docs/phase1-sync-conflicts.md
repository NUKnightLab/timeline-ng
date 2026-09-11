# Local drafts and the published record

**Status: proposal, for markup.** Written 2026-09-11. Picks up a gap Stage 5 exposed: a timeline
can now exist as a local draft in this browser *and* as a published record that something else has
since changed.

## How to read this

Same format as [phase1-undo.md](phase1-undo.md). Judgement calls are tagged and collected at the
end, kept apart because they need different things from a reader. **[A*n*]** are asks — choices you
can judge without reading code, each with a default. **[P*n*]** are my engineering calls, recorded
for visibility, not questions. *(feel)* marks what only a prototype can settle.

---

## The problem, and why it is smaller than it looks

A second browser can only see what is on the PDS. So a timeline opened "somewhere else" has
necessarily been saved, and the only thing that can disagree with a local draft is the **published
record**. Another browser's own unsaved draft is invisible from here, and you cannot reconcile with
what you cannot see.

There are three copies in play, and they are not equal:

- **Local draft** — this browser, a Yjs document with full history.
- **Server draft** — Phase 2 onward. Also a Yjs document, *sharing history* with the local one, so
  the two merge automatically and never conflict.
- **Published record** — plain HTML on the PDS, with no history at all.

Only the published record can genuinely conflict, because only it has no history to merge through.
From Phase 3 the server *produces* that record from the draft, so it becomes an ancestor of the draft
rather than a rival. A real conflict then needs something outside the app to write the record. In
Phase 1 it happens whenever two browsers save, because the PDS is the only thing they share. That is
now, and it is what hand-testing Stage 5 ran into.

## Two bugs this fixes, not just a feature

1. **Saving a stale draft silently overwrites a newer publish.** Edit and save in one browser, then
   save an older local draft in another: `putRecord` replaces the record, and the first browser's
   work is gone with no warning. This is the more dangerous direction and it exists today.
2. **Opening a saved timeline always makes a new local draft.** Open the same timeline twice and
   you have two drafts of it, which never converge and clutter the list.

---

## Detecting change

Every save and load already receives a content hash (CID) from the PDS, and every one of our
wrappers throws it away: `putRecord` → `saveTimeline` returns only the URI, `getRecord` →
`getTimeline` only the timeline, and `listRecords` → the home list only uri, title and `createdAt`.

**[P1]** Change is detected by CID, never by timestamp. A CID changes exactly when content changes;
clocks skew. `createdAt` is not an option anyway: `saveTimeline` rewrites it on every save, so it is
an update time wearing the wrong name.

**[P2]** A draft stores the **base CID**, the version of the record it last agreed with. It lives
in the document's meta beside `savedSnapshot` and is written in the same place, on load and on
successful save, because the two must always describe the same version. `savedSnapshot` is what
lets us tell whether *local* changed; the base CID is what lets us tell whether *published*
changed. Together they are git's common ancestor, and they are what a merge would need later.

That gives four cases, and only one needs a question:

| Local vs base | Published vs base | Case |
|---|---|---|
| unchanged | unchanged | In sync. |
| unchanged | **changed** | Fast-forward: published moved on, and nothing here is at risk. |
| **changed** | unchanged | Ordinary unsaved edits. |
| **changed** | **changed** | Conflict. Both moved; someone has to choose. |

**[P3]** Saving passes the base CID as `putRecord`'s `swapRecord`. The PDS then rejects the write
if the record has changed since, which turns the stale-overwrite check into an atomic
compare-and-swap enforced by the server. A check done before writing would leave a gap between the
check and the write. A rejected swap goes into the conflict flow, Script 6.

**[P4]** Opening a saved timeline reuses an existing local draft with that `atUri`, instead of
making a new one.

**[P5]** The home screen shows **one row per timeline**. At the moment a published timeline with a
local draft appears in both lists. `listRecords` already returns each record's CID, so a row can say
"changed since your draft" without fetching the record.

---

## Script 1 — open a saved timeline with no local draft

1. The record loads, as today.
2. A local draft is created with base CID = the record's CID and `savedSnapshot` = its content.
3. Nothing is shown about sync; there is nothing to say.

## Script 2 — open a saved timeline, local draft exists, both in sync

1. The existing local draft opens ([P4]), with no fetch of the record's content.
2. Its CID is compared with the one the list already has. They match; nothing is shown.

## Script 3 — only published changed (fast-forward)

Nothing local is at risk, since the draft has no edits of its own.

1. The local draft is replaced with the published content, and base CID and snapshot updated.
2. **[A1]** A quiet, dismissible note: *"Updated to the version saved on another device."*

## Script 4 — only local changed

1. The local draft opens with its edits, exactly as an unsaved draft does today.
2. Nothing new is shown; "unsaved changes" already covers it.

## Script 5 — both changed (conflict)

1. The editor does **not** open silently onto either version.
2. A choice is offered, naming what differs: *"This timeline was saved from another device after you
   last edited it here."*
3. **[A2]** Options in the first version: **Keep mine**, **Use the saved version**, **Keep both**.
   - *Keep mine* opens the local draft and marks its base as the current record, so the next save
     overwrites the newer version *knowingly*.
   - *Use the saved version* replaces the local draft. It discards local edits, so the button says
     so.
   - *Keep both* opens the saved version as the timeline and keeps the local edits as a separate,
     unpublished draft titled "… (my changes)". Nothing is lost. This is Dropbox's "conflicted copy".
4. **[A3]** Which option carries the visual emphasis.

## Script 6 — saving hits a changed record

1. Save sends `swapRecord` ([P3]); the PDS rejects it because the record moved.
2. The same choice as Script 5, worded for saving: *"This timeline was saved from another device
   while you were editing. Saving now would replace those changes."*
3. Choosing *Keep mine* re-saves against the new CID, which is the one deliberate overwrite path.

## Script 7 — the published record was deleted elsewhere

1. The draft's `atUri` points at nothing. On open, the list simply has no matching record.
2. The draft stays and is marked "no longer published"; nothing is deleted.
3. Saving publishes it as a new record rather than failing on a missing one.

## Script 8 — signed out or offline

1. The comparison cannot run. The local draft opens as it is.
2. **No claim either way.** The editor must not show "in sync" when it has not checked. If
   anything, a one-line *"Couldn't check for newer versions"*.

---

## Merge: deferred, and the groundwork is already in place

Merging is feasible, and Stage 5 already paid for the hard part. A three-way merge needs a common
ancestor, and `savedSnapshot` plus the base CID ([P2]) *is* that ancestor. Per slide, matched by
`unique_id`, which a published record guarantees is unique, and then per field:

- changed on one side only → take that side;
- changed on both sides to the same value → take it;
- changed on both sides differently → a per-field conflict.

The limit is rich text. A headline or body edited on *both* sides cannot merge character by
character, because the published side is HTML with no history, so those fields surface as per-field
choices. That makes merge a real piece of UI and not just a button, which is the reason [A2]
defaults to leaving it out of the first version.

## Deliberately not decided here

- **Phase 2 wording.** Once a server holds drafts, "saved from another device" mostly means "a
  collaborator published". The mechanism is unchanged; the copy is not.
- **Other people's timelines.** Everything here assumes the owner's own records. A collaborator
  cannot publish, so they never hit Script 6.
- **Checking in the background** while a draft is open. It is useful and possible, but polling is its
  own decision; this spec checks on open and on save only.

---

## Asks

| | Ask | Default if you have no view |
|---|---|---|
| A1 | When only the published version changed, update quietly with a dismissible note, or ask first? | Update, with a quiet note; nothing local is at risk |
| A2 | Should the first version of the conflict choice include merge, or only Keep mine / Use saved / Keep both? | The three without merge; merge later |
| A3 | Which option in the conflict choice gets the emphasis? | *Keep both*, the only choice that cannot lose work |

## Decisions I made

| | Decision | Revisit if |
|---|---|---|
| P1 | Detect change by CID, never by timestamp | |
| P2 | Store the base CID beside `savedSnapshot`, written together | |
| P3 | Save with `swapRecord` so the overwrite check is atomic on the server | A PDS implementation mishandles `swapRecord` |
| P4 | Opening a saved timeline reuses its existing local draft | |
| P5 | One home-screen row per timeline, using `listRecords` CIDs | Merged rows prove harder to read than two lists |
