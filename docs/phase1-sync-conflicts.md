# Local drafts and the published record

**Status: partly shipped; the rest is proposal, for markup.** Written 2026-09-11, revised
2026-10-27. Picks up a gap Stage 5 exposed: a timeline can now exist as a local draft in this browser
*and* as a published record that something else has since changed.

**What has shipped since this was written.** [P4] landed in `536221b` (2026-10-22), and with it the
second of the two bugs below. **[P1], [P2], [P3] and [P8] landed on 2026-11-02**, and with them the
dangerous one: a draft now records the CID of the version it agreed with, and publishing passes it
as `putRecord`'s `swapRecord`, so a write that would overwrite a newer record is refused by the PDS
rather than detected by us. The four cases of the table in *Detecting change* are a pure function,
`lib/syncState.ts`.

**Verified against the devnet PDS on 2026-11-02**, which is the reference implementation, so [P3]'s
"revisit if a PDS mishandles `swapRecord`" has an answer for at least this one. A correct swap is
accepted, so ordinary republishing is unaffected; a stale swap is refused with status 400 and
`error: 'InvalidSwap'`; the record keeps the other version, which before this change the stale draft
silently replaced. `getRecord` and `listRecords` both return a CID, and they agree with the one
`putRecord` minted. Confirmed end to end in the app too, including across a reload: a draft reopened
from `y-indexeddb` still carried its base CID and was still refused.

One observation worth keeping for the conflict flow: the refusal's message carries the record's
current CID (`Record was at bafy…`), so the published version is knowable without a fetch. Not built
on — parsing an error message is brittle, and Scripts 5 and 6 need the record's *content* to describe
the difference anyway, which means fetching it regardless.

**The scripts landed the same day.** Scripts 2, 3, 4, 7 and 8 behave as written; [P9] merges when
the overlap is empty and says so in a line; Scripts 5 and 6 present the three-way choice with [P6]'s
loss framing, *Keep both* emphasized ([A3]), and [P10]/[P11]'s fork, shown attached to its original
([A4]). The comparison itself is `lib/threeWay.ts` and the decision `lib/reconcile.ts`; the editor
does the fetching and the asking.

All of it was exercised against the devnet PDS, one device against a script standing in for another:
a fast-forward updates quietly, disjoint edits merge with no prompt, a collision on one field raises
the dialog at both open and publish, *Keep mine* then publishes over the newer version, and *Keep
both* leaves a fork that is listed under its original and cannot publish. *Use the published
version* is covered by tests rather than by hand.

Three things the design did not anticipate, all found by hand-testing:

- **Cleanliness was compared as JSON text.** A settings map that gained its keys in a different order
  than the record lists them serializes differently while holding the same settings, so a draft that
  had just taken on the published version still reported unpublished changes — which turned Script 3
  into Script 5 on the next comparison. It compares structurally now, with `sameValue`.
- **The share image was published but never recorded.** `handlePublish` generates a poster, uploads
  it and publishes it without writing it back into the document, so from its first publish every
  draft disagreed with its own record about `settings.ogImage`. Invisible until something compared
  the two — and then visible as a conflict dialog claiming the settings had changed on the other side
  every single time.
- **URLs derived from blob references are not content.** `getTimeline` builds one for each
  blob-backed image from the CID and the PDS origin. They are left out of the comparison: they are
  recomputed on every read and would change if the account moved hosts.

**[P12]'s pull-list shipped on 2026-11-03**, which is what makes *Keep both* a deferral rather than
a trap: until it existed a fork could be opened and read but not reconciled, and the only way to get
an edit back was to retype it. A timeline with a fork now carries a line offering to review it, and
the panel lists what the fork has that this version does not — one row per slide, each a single
`USER_ORIGIN` transaction, so Cmd-Z undoes a pull and the row comes back. The list is recomputed
after every pull rather than tracking what was clicked, which is what makes it empty out; when it is
empty the panel offers to delete the copy, so reconciliation has an end state.

With somewhere to go, *Keep both* now asks **when** rather than only keeping the work: *Go through
them now* opens the pull-list at the moment of the conflict, *Leave them for later* returns to the
editor. Only offering "later" made the reconciliation something to rediscover on the home screen,
and the moment the two versions are clearest in mind is the one the dialog interrupts.

**[P6]'s field-level comparison shipped on 2026-11-10.** A row that said only "Changed in your
copy" could be counted but not evaluated — the two documents are both the author's and usually
differ in one word, so the real question is not "do I want this slide?" but "do I want *this*
headline?". Each edited row now opens into one line per differing field, both values side by side,
with a take of its own. Three things fell out of building it:

- **The data model's keys are the wrong granularity.** `text` holds the headline and the body, and
  `media` holds the image with its caption, credit and alt text. Comparing at that level would make
  a one-word headline fix carry a rewritten paragraph with it, so the fields are listed explicitly
  in `pullFields.ts` — with a getter, a renderer and a non-mutating take each — rather than walked
  off the object.
- **A per-field take needs no new write path.** `replaceEvent` writes a whole slide including its
  prose, so one field is `{...working, [field]: fork[field]}` through that same call: one
  `USER_ORIGIN` transaction, one Cmd-Z, identical to taking the whole row.
- **Derived values must not become rows.** A media URL is recomputed from the CID and the PDS
  origin on every read, so two sides holding the same upload disagree about it while meaning the
  same thing. The comparison reads through `comparable()`, the same strip the three-way merge uses.

The panel moved from a right-hand drawer to a centered one at the same time: two values side by
side need the width, and at 26rem only one of them could ever be on screen.

**An automatic merge is now visible and reversible — [P9] revisited, 2026-11-10.** Auto-merging was
worse than it looked: `adopt` applies the result under `LOAD_ORIGIN` and then clears the undo
stack, so slides could arrive from another browser with no way to see what they were and no way to
take them back. The merge still happens without asking — most are trivial, and a dialog for every
trivial one is how people learn to dismiss the dialog that matters, which is the conflict. What
changed is everything after it:

- **The note names what arrived** ("3 changes published from another browser: Apollo 11, Voyager 1
  and Settings") instead of counting them. The analysis was already computed and thrown away.
- **"See what changed" opens the same panel**, in `incoming` mode: the rows are what landed, each
  with the before-and-after comparison and *Put it back* per row and per field.
- **A fast-forward gets the same list, read-only** (`arrived` mode). Nothing local was at risk, so
  there is nothing to put back, but "what changed in my account while I was away" is worth seeing.
- **Putting something back is an ordinary edit**, so Cmd-Z reaches it. The merge as a whole stays
  non-undoable: undoing the content without the `baseCid` would leave the document claiming
  agreement with a record it no longer matches.

The comparison is a plain two-way diff — `before` and `after` are two states of the same document,
so there is no third version to attribute anything to. The rows are `PullEntry` and nothing else,
so `applyPull`, `applyPullField` and the panel work unchanged; `kind` keeps its meaning (what
applying this row would do), which inverts against the arrival: a slide the merge *added* is a row
that *removes* it, because the version on offer is the one from before. One expectation that did
not survive contact: `pullList(base, preMergeLocal, merged)` looked like it would give the incoming
set for free, and it gives nothing — in a clean merge both sides' changes land, so the local
document has nothing the merged one lacks.

**Set-aside edits cannot outlive their timeline.** Deleting a timeline used to leave them behind,
where they became a row warning about a timeline "above" that no longer existed and could never be
sorted into anything — the one operation needs the other open as the working document. Deleting a
timeline now takes them with it (`forgetDraftWithForks`, a storage-level invariant rather than a
screen's behaviour), and the confirmation says so before the click. The cascade runs one way only:
deleting the set-aside edits is still just deleting them. A batch whose timeline is gone from this
browser but still exists in the account is not orphaned for good — reopening the record from the
account restores the pairing, since forks are matched by `atUri` — so the existing ones are left
where they are rather than swept up.

**The two sides are "the timeline" and "set aside".** Naming them took four tries, and every
earlier pair failed the same way: both documents are the author's and both are the same timeline,
so "yours" / "this one" and "your copy" / "the published timeline" read as the same thing. The
second of those was wrong on its own terms, too — the author is editing *the* timeline and
responding to changes that happened to be published, not editing a published one. What actually
separates the two is that one is the timeline as it stands and the other is a change that never
landed, so that is what the panel says: **In the timeline** against **Set aside**, with each row
naming both in a sentence ("You changed this."). The panel is titled *Sort out the differences* —
the task, in the words someone would use for it, rather than a label for the thing.

**A row needs both ways out.** With only a take, a row you did not want was a dead end: the list is
recomputed from the documents every time and remembers nothing, so the row returned on every open,
the fork could never empty, and the editor went on saying there were edits to deal with. *Keep
what's here* settles it, and the decision is recorded by **moving that slide's recorded ancestor up
to the fork's own version of it** — the ordinary way a merge records a resolution. The fork then has
no change to report for that slide, so the row stops being offered however far the working document
travels afterwards. Two consequences, both accepted: the fork's content is untouched (opening it
still shows what it held), and because this is not a document edit, Cmd-Z does not bring the row
back. The panel says so rather than leaving it to be discovered.

Two further corrections from hand-testing on 2026-11-03:

- **A fork is a dead end no longer.** Opening one said what it was and stopped there; it now
  carries a line naming the timeline it came from, saying the copy can never be published on its
  own, and offering to go there with the pull-list open.
- **The editor's line is computed, not counted.** It used to come from the draft index, which knows
  a fork exists but not whether anything in it is outstanding — so a fork already worked through
  still announced edits to bring across, and the panel then said there were none. Each fork is now
  read and compared when a timeline is opened and after every pull. A fork with nothing left is
  said to have nothing left, and the line offers to delete it instead.

Two things that fell out of building it. `writeSlide` deliberately ignores rich text when a fragment
owns the field — an editor re-emits stale prose on every keystroke — so a pull through the ordinary
slide write would have reported success and left the headline alone; `overwriteSlide` rebuilds the
fragments from the incoming prose instead, and is the one write that does. And a fork lives in its
own IndexedDB database, so the panel attaches a second provider, reads, and detaches: a provider left
attached to a per-draft database is a leak nobody would notice until a browser held a dozen drafts.

What remains: nothing specified. [P6]'s field-level fidelity and [P5]'s one row per timeline have
since shipped, and [P7]'s preview was struck — see its entry. The status span also still replaces
the Publish button while it is up, so a refusal sits where the control to act on it used to be; it is
amber and wraps now, rather than green and `nowrap`, which was pushing Share and the account menu off
the end of the subnav.

**A1–A4 were answered on 2026-10-27**, all four as their defaults; the body now states them rather
than asking.

**Added 2026-10-27:** how the difference between two versions is described to a person, automatic
merging when the two sides do not collide, and what reconciliation after *Keep both* actually looks
like — [P6]–[P12]. The opening claim that a second browser can only see the PDS is also
qualified: true today, not from Phase 2 — see *Joining an existing server draft*, which adds [P13].

Writing to the PDS is called **publishing** throughout, never "saving": an atproto repo is public,
so the record is readable by anyone the moment the write succeeds.

To drive these scripts by hand against devnet, see
[phase1-sync-conflicts-by-hand.md](phase1-sync-conflicts-by-hand.md).

## How to read this

Same format as [phase1-undo.md](phase1-undo.md). Judgement calls are tagged and collected at the
end, kept apart because they need different things from a reader. **[A*n*]** are asks — choices you
can judge without reading code, each with a default. **[P*n*]** are my engineering calls, recorded
for visibility, not questions. *(feel)* marks what only a prototype can settle.

---

## The problem, and why it is smaller than it looks

**Today**, a second browser can only see what is on the PDS. So a timeline opened "somewhere else"
has necessarily been published, and the only thing that can disagree with a local draft is the
**published record**. Another browser's own local draft is invisible from here, and you cannot
reconcile with what you cannot see. From Phase 2 that stops being true — a Durable Object is
precisely a view of unpublished edits that a second browser *can* see — and the conclusion still
holds, but conditionally; see *Joining an existing server draft* below.

There are three copies in play, and they are not equal:

- **Local draft** — this browser, a Yjs document with full history.
- **Server draft** — Phase 2 onward. Also a Yjs document, *sharing history* with the local one, so
  the two merge automatically and never conflict.
- **Published record** — plain JSON on the PDS, with no history at all.

Only the published record can genuinely conflict, because only it has no history to merge through.
From Phase 3 the server *produces* that record from the draft, so it becomes an ancestor of the draft
rather than a rival. A real conflict then needs something outside the app to write the record. In
Phase 1 it happens whenever two browsers publish, because the PDS is the only thing they share. That is
now, and it is what hand-testing Stage 5 ran into.

### Joining an existing server draft

"Sharing history" above is a property of how a document was *created*, not something Yjs provides —
so it is worth saying when it is true.

**It is always true for collaborators.** Someone invited to a timeline receives the document; they
never build one. The case below cannot arise for them.

**It is normally true for the owner's own browsers too**, because a browser joining an existing
server draft should connect an **empty** document and let the provider fill it from the Durable
Object. It has no reason to build one from the published record, and if it does not, there is
nothing to diverge.

**[P13]** A browser joining a server draft connects empty and syncs. A local draft that already
exists is reconciled separately and **never attached**. The default wiring makes this easy to get
wrong: `y-indexeddb` and the network provider attach to the *same* `Y.Doc`, so a populated local
store and a populated Durable Object both load into one document.

That is the failure worth naming, because the result is silent and ugly. Internal keys are random
and explicitly per-document (`newSlideKey` in `lib/doc.ts`), while `unique_id` is derived
deterministically from the headline (`assignSlideIds` in core). Two browsers that each opened the
same published record therefore hold the **same `unique_id`s under different internal keys**, and
since slides live in a `Y.Map` keyed by the internal key, loading both into one document yields
every slide twice.

**When this can actually happen: at promotion.** Promotion is lazy — only shared timelines get a
Durable Object ([coauthoring.md](coauthoring.md) §3.3) — so there is a moment when a timeline that
has been edited locally in more than one browser first acquires a server draft. One of those local
documents seeds it; the others are independently built and cannot simply be attached. Because
promotion is lazy rather than a one-time migration, this moment recurs for as long as the feature
exists, which is why [P13] is a standing rule and not a migration note.

The leftover documents are then the same shape as *Keep both*: diverged from a known base, to be
reconciled rather than merged, which is what [P10]–[P12] describe. Note the direction of that
dependency — the fork machinery is the mechanism available here, not the reason to build it. Its
justification stays Scripts 5 and 6.

## Two bugs this fixes, not just a feature

1. **Publishing a stale draft silently overwrites a newer version.** Publish in one browser, then
   publish an older local draft in another: `putRecord` replaces the record, and the first
   browser's work is gone with no warning. This is the more dangerous direction and it **still
   exists today**.
2. ~~**Opening a published timeline always makes a new local draft.**~~ **Fixed in `536221b`.**
   Opening the same timeline twice used to leave two drafts of it, which never converged and
   cluttered the list. `handleOpenRecord` now looks for a draft carrying that `atUri` and reopens it
   instead of minting another — see [P4].

---

## Detecting change

Every publish and load already receives a content hash (CID) from the PDS, and every one of our
wrappers throws it away: `putRecord` returns only the URI, `getRecord` → `getTimeline` only the
timeline, and `listRecords` → the home list only uri, title and `createdAt`.

**[P1]** Change is detected by CID, never by timestamp. A CID changes exactly when content changes;
clocks skew. `createdAt` is not an option anyway: it is rewritten on every publish, so it is an
update time wearing the wrong name.

**[P2]** A draft stores the **base CID**, the version of the record it last agreed with. It lives
in the document's meta beside `publishedSnapshot` and is written in the same place, on load and on a
successful publish, because the two must always describe the same version. `publishedSnapshot` is what
lets us tell whether *local* changed; the base CID is what lets us tell whether *published*
changed. Together they are git's common ancestor, and they are what a merge would need later.

That gives four cases, and only one needs a question:

| Local vs base | Published vs base | Case |
|---|---|---|
| unchanged | unchanged | In sync. |
| unchanged | **changed** | Fast-forward: published moved on, and nothing here is at risk. |
| **changed** | unchanged | Ordinary unpublished edits. |
| **changed** | **changed** | Conflict. Both moved; someone has to choose. |

**[P3]** Publishing passes the base CID as `putRecord`'s `swapRecord`. The PDS then rejects the
write if the record has changed since, which turns the stale-overwrite check into an atomic
compare-and-swap enforced by the server. A check done before writing would leave a gap between the
check and the write. A rejected swap goes into the conflict flow, Script 6.

**[P4]** *(shipped, `536221b`)* Opening a published timeline reuses an existing local draft with
that `atUri`, instead of making a new one. The implementation reads the draft list from the store
rather than a component's copy of it, so the one-draft-per-record invariant holds whatever the caller
does. The home screen also asks before replacing a draft that has unpublished edits, and discarding
forgets that draft first — otherwise the reopen would find the very edits the reader chose to drop.

**[P5]** *(shipped)* The home screen shows **one row per timeline**. It used to draw two lists —
drafts in this browser, records in the account — so a published timeline that had been opened here
appeared in both, as two rows for one thing, each with its own ✕ meaning something different.

A row is a **timeline**; where it lives is something the row *says* rather than something its
position implies. Six states, in `lib/timelineRows.ts` so the matching and the ordering can be
tested without going through markup: *never published*, *published*, *unpublished changes*, *a
newer version was published elsewhere*, *no longer in your account*, and an unmerged draft nested
under its timeline ([A4]).

*No longer in your account* is only ever said about a draft carrying an `atUri` — published from
here, or opened from a record — and only once a signed-in fetch has actually completed. An empty
record list is not evidence: signed out or mid-request it means nobody looked, and reading it as
absence told people their published work had vanished every time they opened the page signed out.

Every row is built the same way — a verb, a relative time, and a state where there is one more
thing to say — because the mixed case is the normal case and will be from the first deploy. Drawn
from different materials, a relative phrase for a local copy and an absolute date for a record,
two rows for two timelines read as two different kinds of object when the only real difference is
whether this browser has a copy. A record's `createdAt` is rewritten on every publish, so it means
*last published* and compares honestly against a draft's `editedAt`. The one difference left is
the state itself, which is the point of the row. And the fact that unpublished timelines live only
in this browser is a footnote under the list rather than a tag repeated on each row it applies to.

The fourth is what the merge buys. `listRecords` already returns each record's CID, and a draft now
records the CID it was last in step with, so the list can say another browser got there first
without opening anything. Previously that was only discoverable by opening the draft.

Two things follow from one row. The question asked when opening a published timeline that had local
edits — *continue editing, or discard them?* — is gone, because it existed to disambiguate a second
way of opening something this browser already had, and there is now one way. And ✕ has one meaning,
delete this timeline, with the consequence following from whether it is public rather than from
which list it was in: see below.

The older note, kept because the mechanism is unchanged: `listRecords` already returns each
record's CID, so a row can say
"changed since your draft" without fetching the record.

*Partly overtaken.* The two lists remain — "In this browser" and "In your account" — but [P4] stopped
duplicates accumulating, and rows now say whether they are published. What is left here is
presentation rather than correctness, which lowers its priority: merge the lists when a row can also
carry the CID comparison, not before.

---

## Script 1 — open a published timeline with no local draft

1. The record loads, as today.
2. A local draft is created with base CID = the record's CID and `publishedSnapshot` = its content.
3. Nothing is shown about sync; there is nothing to say.

## Script 2 — open a published timeline, local draft exists, both in sync

1. The existing local draft opens ([P4], shipped), with no fetch of the record's content.
2. Its CID is compared with the one the list already has. They match; nothing is shown. *(Not built:
   nothing records a CID yet.)*

## Script 3 — only published changed (fast-forward)

Nothing local is at risk, since the draft has no edits of its own.

1. The local draft is replaced with the published content, and base CID and snapshot updated.
2. **[A1 · answered]** A quiet, dismissible note: *"Updated to the version published from another
   device."* Not a prompt: nothing local is at risk, so there is no decision to hand over — but the
   content did change, and Script 8's rule cuts both ways, so it is said rather than hidden.

## Script 4 — only local changed

1. The local draft opens with its edits, exactly as an unpublished draft does today.
2. Nothing new is shown; "unpublished changes" already covers it.

## Script 5 — both changed (conflict)

Reached only when the two sides genuinely collide; disjoint changes merge without asking ([P9]).

1. The editor does **not** open silently onto either version.
2. A choice is offered, naming what differs: *"This timeline was published from another browser
   after you last edited it here."*
3. **[A2 · answered]** Three options, with no per-slide merge UI: **Keep mine**, **Use the
   published version**, **Keep both**. Per-slide work belongs in the pull-list after *Keep both*
   ([P12]), where it is built once and met in a calmer moment than a modal hit mid-publish.
   - *Keep mine* opens the local draft and marks its base as the current record, so publishing next
     overwrites the newer version *knowingly*.
   - *Use the published version* replaces the local draft. It discards local edits, so the button
     says so.
   - *Keep both* opens the published version as the timeline and keeps the local edits as a
     **fork** — a separate draft that is not a publish claim ([P10]) and that carries the base it
     diverged from ([P11]). Nothing is lost, and the reconciliation afterwards is a pull-list rather
     than two windows side by side ([P12]). Dropbox's "conflicted copy", with the ancestor kept.
4. **[A3 · answered]** ***Keep both* carries the emphasis** — the only option that cannot lose
   work. The fast path is then also the safe one, and the cost of taking it without much thought is
   a reconciliation task rather than discarded edits.

## Script 6 — publishing hits a changed record

1. Publish sends `swapRecord` ([P3]); the PDS rejects it because the record moved.
2. The same choice as Script 5, worded for publishing: *"This timeline was published from another
   device while you were editing. Publishing now would replace those changes."*
3. Choosing *Keep mine* publishes again against the new CID, the one deliberate overwrite path.

## Script 7 — the published record was deleted elsewhere

1. The draft's `atUri` points at nothing. On open, the list simply has no matching record.
2. The draft stays and is marked "no longer published"; nothing is deleted.
3. Publishing creates a new record rather than failing on a missing one.

## Script 8 — signed out or offline

1. The comparison cannot run. The local draft opens as it is.
2. **No claim either way.** The editor must not show "in sync" when it has not checked. If
   anything, a one-line *"Couldn't check for newer versions"*.

---

## Describing the difference (Scripts 5 and 6)

"Naming what differs" understates the problem: a symmetric diff of two timelines is not what someone
needs at that moment. They do not need to compare two documents, they need to know **what each button
costs them**. So the summary is loss-framed per option rather than neutral:

- *Keep mine* → the 2 slides published from the other browser go away
- *Use the published version* → your last 40 minutes here go away
- *Keep both* → nothing is lost; there is a reconciliation to do later

**[P6]** The description is computed as a three-way, never a two-way: base ([P2]), mine, theirs. A
two-way diff makes every difference look like a disagreement, including the person's own unpublished
work, which is not in dispute with anything. The three-way attributes each change to a side — *you
changed this; the published version changed that.* The derived fact that matters most is the
**overlap**, what both sides touched, and everything else follows from it, including whether there is
a decision to make at all ([P9]).

**Fidelity.** Slide-level per side is the floor worth shipping: added, removed, edited, matched by
`unique_id`, which a published record guarantees is unique. Field-level inside contested slides is a
cheap extension, since the walk already compares field by field, and it is often reassuring —
slide-level overlap is frequently non-empty when field-level overlap is empty. `sameValue` in
`lib/doc.ts` is already the structural equality this needs; it is module-private today.

Diffing the *text* of contested rich-text fields is deliberately out of the first version. Note this
is a different question from merging them: a display diff needs no history, so it stays available
later if the slide-level account proves too coarse.

**[P7] — struck, 2026-11-11.** It proposed **Preview the published version**, opened at the first
contested slide, on the grounds that a timeline is a visual artifact and a prose change list is a
poor proxy for one. Both halves of that turned out to be wrong by the time the rest shipped.

*Not nearly free.* The embed does accept an arbitrary timeline, but `EditorView` binds that message
to its own `timeline` and to `previewStartIndex`, which is derived from the editor's selected
slide. Showing the published version at a chosen index needs props threaded App → EditorView, and
the conflict dialog is a sibling modal, so previewing from it stacks two `aria-modal` dialogs with
focus and Escape to arbitrate — mostly modal plumbing rather than feature.

*And no longer the best answer.* [P7] was written when the dialog was the only place anything was
shown. [P6] and [P12] since put **both versions side by side, field by field**, behind the option
that carries the emphasis and cannot lose work. A preview shows one side at a time, which informs
*Use the published version* and not *Keep mine* — the choice where comparing is the whole question.
The dialog's job is to get someone somewhere safe, and the safe place now holds more than a preview
could.

What survives is the complaint underneath: the dialog counted ("2 slides and the settings") where it
could name. The overlap sentence — the fact that usually settles the choice — now names the slides
it is about.

**Two honest limits.** We can report only *net* change on the published side, never an activity log:
our own history is in Yjs, theirs is flat JSON, and "changed the title" may have been six edits by
two people. And the base can be missing — drafts predating base CIDs, and Script 7's deleted record —
in which case the comparison degrades to a two-way that cannot attribute sides, and should say less
rather than guess.

**One asymmetry between the two scripts.** Script 5 catches someone at open, before they have invested
anything in the session, and a comparison is welcome there. Script 6 interrupts a deliberate publish,
after an editing session, when they are attached to their version and have already decided they want
it out. Same mechanism; Script 6 leads with what they would *replace* and keeps the comparison one
click away, rather than making them study a two-column screen to finish what they asked for.

**[P8]** `listTimelines` returns `{ uri, title, createdAt }` and drops each record's `cid`; it has to
carry the CID for detection anyway. Note the inversion with [P1]: `createdAt` is useless for
*detecting* change, being rewritten on every publish, but it is the only thing we have for
*displaying* "published 20 minutes ago" — often the fact that settles the decision.

---

## Merging: automatic when unambiguous, a choice only when not

Merging is feasible, and Stage 5 already paid for the hard part. A three-way merge needs a common
ancestor, and `publishedSnapshot` plus the base CID ([P2]) *is* that ancestor. Per slide, matched by
`unique_id`, and then per field:

- changed on one side only → take that side;
- changed on both sides to the same value → take it;
- changed on both sides differently → a genuine collision.

The limit is rich text. A headline or body edited on *both* sides cannot merge character by character,
because the published side is HTML with no history. **But that limit only bites inside the overlap.**
When the two sides touched disjoint slides there is no judgement call anywhere in the merge: no field
has two values, so nothing needs a UI to choose between them.

**[P9]** When the overlap is empty, merge automatically and say so in a line. The conflict choice
appears only on a real collision.

This is the largest reduction in drag available here, because it is the difference between
reconciliation being the routine outcome and the uncommon one. Everything downstream — the fork, its
provenance, the pull-list — is then polish spent on a rare path rather than the default one. It also
costs nothing extra: the overlap is already computed to describe the difference ([P6]).

---

## *Keep both*, and the reconciliation after it

"Nothing is lost" is true but incomplete — nothing is lost *yet*, and the cost is deferred to a moment
when it is more expensive to pay. If reconciliation means opening two windows and eyeballing them, the
option is a trap.

### The fork is not a second claim on the record

As originally written, *Keep both* produces a second draft of the same record, which collides head-on
with [P4]: `listDrafts().find((d) => d.atUri === uri)` would choose between the two arbitrarily. That
is exactly the two-claims-on-one-record bug `536221b` fixed.

Dropping the `atUri` instead is worse. `publishTimeline` generates a fresh rkey whenever `existingUri`
is absent, so a stray publish of a fork silently creates a **second public timeline** while existing
share links still point at the first.

**[P10]** The fork is a third kind of thing: not a publish claim, not an orphan. It holds no `atUri` in
the draft index, so [P4]'s invariant is untouched, and it is **publish-blocked by default**. Publishing
it at all takes an explicit choice between *publish over the original* and *publish as a new timeline*.

### The fork keeps the comparison, not just the content

This is what decides whether reconciliation is a drag. Reconciling later degenerates into eyeballing
precisely because the **base is gone** — and the base is in hand, for free, at the moment the fork is
created.

**[P11]** The fork carries `forkedFrom: { atUri, baseCid, baseSnapshot }` alongside its content;
`DraftSummary` takes one optional field. With provenance kept, reconciliation a week later is still a
three-way — the same analysis as Script 5, re-runnable on demand — rather than a two-way diff that
cannot tell the person's own work from anyone else's. *Keep both* then means "defer with the materials
kept," not "defer forever."

### Reconciliation is a pull-list, not a merge screen

**[P12]** The fork is treated as a **source to pull from**, not a peer to be merged:

- the published-backed timeline is the working document — the one with the `atUri`, the one links
  point at;
- a side panel lists what the fork has that the working document does not: *"3 changes not in this
  version"*;
- each entry has **Bring this over**, at slide granularity.

Two properties fall out. Each *bring over* is one `USER_ORIGIN` transaction, so **Cmd-Z undoes it** —
already paid for in Phase 1 — which makes the panel safe to experiment with instead of a sequence of
commitments. And when the panel empties the fork has served its purpose, so the app can offer to
delete it: reconciliation gets a visible end state rather than trailing off.

The panel usually holds two or three entries, because the overlap is small. It is "here are the things
you did," not "merge two documents." For a slide edited on both sides the same control degrades to
*replace this slide with my version*, comprehensible with no field-level UI. Field-level only if that
proves too blunt in practice.

### How the fork is presented

**[A4 · answered]** A fork is shown **attached to its original** — indented beneath it, labelled
*"3 changes not in the published version"*, with a **Reconcile** action. Shown instead as its own row
reading "Rome (my changes)", it looks like a separate project and will be deleted or published by
mistake. Same data, very different odds of ever being resolved.

### Drafts are not keyed by account, and are not hidden by one

**[P22]** A browser can hold work for more than one identity — publishing personally and for an
organisation is ordinary — and signing out of one account and into another left every draft in the
list, unmarked.

Local storage is deliberately **not** keyed by DID. That would mean needing to be signed in before
starting a timeline, which is the opposite of what offline editing is for, and it would make a
draft's existence depend on a session. Ownership belongs to the record: a published draft's
`atUri` is `at://<did>/…`, so the owner is already there for exactly the drafts that have one. A
draft that has never been published has no owner, because it is not owned by anyone until it is.

Rows owned by another account are **listed and labelled**, never hidden. Hiding reads as the app
having lost a timeline, and whoever has the browser has the drafts regardless; the label says which
account the row publishes to, so both sets are visible at once instead of one being behind a
session switch.

The correctness half matters more than the label. This account's record list is not evidence about
another account's record, so those rows are left out of the comparison entirely — no *gone*, no
*behind*. Without that they read "no longer in your account", which is a confident and wrong
statement about somebody else's timeline, and signing in as a second account made every row of the
first say it.

The handle is recorded beside the `atUri` for display only, since a DID is not something anyone
recognises and resolving one per row per paint is not worth a network request. It can go stale —
handles are reassignable — and a stale handle on a row already marked as another account's is a
smaller wrong than the lookup. A draft written before this says *another account* instead.

The dangerous point was already guarded: publishing a draft whose `atUri` names a different account
asks whether to publish it as a new timeline in the current one.

The editor needed the same test, and for the same reason. Opening such a draft ran Script 7 — the
record is not in this account's list — and announced *"This timeline is no longer in your account.
Publishing will put it back."* Both halves wrong: it never was in this account, and publishing
would not put anything back, it would offer to make a new timeline here. `checkPublished` now
checks the owner before it asks the account anything, and says whose it is instead.

### One ✕, and what follows from it

**[P21]** On a merged row the ✕ means *delete this timeline*, and that is its only meaning. The
ambiguity people worried about — does it delete my copy or the published one? — was an artifact of
two lists each having their own.

What differs is the consequence, and it is read from the timeline rather than from the control:

- **Never published.** It costs local work and nothing else. No confirmation: the row goes at once
  and is replaced in place by an undo card for a few seconds. A question before the fact asks
  someone to predict what they are about to lose; a card after it shows them.
- **Published.** It takes the record with it, so every embed and share link stops working for
  everyone, permanently. That asks first, names both halves of what goes, and the demo timeline
  keeps its type-DELETE.

The deletion is real either way — it is not deferred. The index entry goes immediately and the
document follows when the window closes, with the ids in flight written to localStorage so
`sweepPendingDeletions` can finish any the page did not outlive. Deferring has the worse failure:
the author asks for something and, if the tab closes, it silently never happens.

**Dropped with the second list:** deleting *only* the local copy. It was reachable only because the
lists were separate, and its real use — abandon local edits and take the published version — was
already better served elsewhere, by the conflict dialog's *Use the published version* when the two
have actually diverged. The gap that remains is abandoning local edits when the record has **not**
moved, which `docs/roadmap.md` already records as left open by [P4].

### Publishing is not blocked by an unmerged draft

**[P20]** Asked directly while testing: should publishing be refused while an unmerged draft is
outstanding, on the grounds that reasoning about what is and is not public is hard? Decided **no**,
with the reasoning kept because the instinct behind the question is a good one.

A fork is already publish-blocked by design ([P10]) — it holds no `atUri` and never can. Block the
parent as well and, the moment someone chooses *Keep both*, there are two documents and neither can
publish: the timeline is frozen until the merge is finished. *Later* stops being an option anyone
can take, which turns the one choice that cannot lose work into the expensive one, and teaches
people to reach for *Keep mine* — which does lose the other browser's work. The emphasis [A3] puts
on *Keep both* would be inverted by the mechanics.

There is also no correctness to protect. A fork carries its own ancestor, so the comparison stays
honest however far the published timeline travels in the meantime, and publishing is a `swapRecord`
against the current base, so the record never lands in a state nobody authored. The unmerged draft
is a separate document and cannot be swept in by accident. Nor is the timeline ever "partly"
published: it goes out whole, and the draft is a set of edits nobody has decided about yet.

What was true in the question is that nobody should have to *infer* any of this. Three things say
it instead:

- The note after *Keep both* at a refused publish opens with **"Nothing of yours was published"**
  and then says what you are looking at instead.
- Publishing while something in the draft is still outstanding asks once, and says what is not
  included, before it writes.

The subnav's **"Published ✓"** stays as it is. It was the trigger — the document adopts the record,
so the tick reappears truthfully a second after a publish was *refused*, and reads as a receipt for
it — but the badge is a state about the timeline and is right every other minute of its life.
Rewording it to something unambiguous ("Matches published") was tried and reverted: it is wordier,
it sounds like a diff, and it pays that cost permanently to fix a collision that lasts one screen.
The note is the thing with room to explain, so the note explains, and it is phrased to account for
the tick rather than to contradict it.

### A row is named for its effect, not its origin

**[P19]** A row's `kind` describes what answering it would do to the working document — add a
slide, remove one, replace one — and not what the draft did to its ancestor. The two part company
in exactly one case, and it is a case people hit: both browsers add a slide under the same id.

The draft's change is then an addition, but the working document has a slide there too, so keeping
the draft's replaces rather than adds. Taken from the ancestor diff, the row said *"You added this;
the published timeline does not have it"* directly above a comparison showing the published version
of it, and offered a button reading *Keep mine — add the slide* that would have replaced one.

Such a row also has no shared version to be an edit *of*, so it gets its own sentence — *"You made
this, and so did the published timeline — they are not the same"* — and drops the separate
contested warning, which was the second half of the contradiction.

### The share image is not content

**[P18]** `settings.ogImage` is left out of every comparison — the equality test, the conflict
analysis and the panel's lines alike.

Publishing regenerates the poster from the title slide and uploads it afresh on every publish, so
whatever either side holds is replaced the next time anyone publishes. Two browsers rendering the
same title slide do not produce byte-identical PNGs either, so their blobs carry different CIDs for
something nobody authored. Treated as content it produced conflicts and rows that could not be
caused, could not be evaluated, and would not have mattered whichever way they were answered —
which is also how a broken blob reference once announced itself, as *"and the settings"* in every
conflict dialog.

It follows that the share image is not something a pull can carry either: taking a settings row
leaves the working document's poster alone, rather than swapping in a draft's for the hours before
the next publish throws it away.

### Both choices live on the line

**[P17]** A line used to carry *Keep mine* alone, with the published half of the choice available
only as a whole-row button. That left a question with no answer on screen: does the row's *Keep
published* also undo the lines I already kept? (It did not — a line drops off as soon as the
document holds its value — but nothing said so.)

Each line now carries the pair, and the row's buttons say *Keep all of mine* / *Keep all
published*, which can only mean the lines still showing. Declining a line is recorded exactly as
declining a row is: the ancestor's value for that one field moves up to the draft's, so the draft
has no change left to report for it.

That only works if a line is derived from the ancestor, which turned up a second bug worth having
found. A row listed every field where the draft and the published version differed — including
fields **only the published side changed**. Those sat there with a *Keep mine* button that would
have reverted someone else's published work under the name of keeping your own. A line is now
offered only where the draft itself changed something.

### A row has to be readable, or it is not a row

**[P16]** Found by hand, 2026-11-11: a merge announced *"One change published from another
browser: Settings"* when no setting had been touched, and the panel showed the row with nothing
under it.

Two tests decide a row, and they had drifted apart. Inclusion is structural — are the two sides
equal? — while the row's contents are rendered field by field. One side spelled "no settings" as an
absent value and the other as an empty object: structurally different, different in no field, so
the row could be counted and not read. Worse, a row like that cannot always be cleared, since
answering it writes a value the structural test still reads as different.

Both halves are fixed. `comparableSettings` now normalizes the several ways of writing nothing — an
absent value, `null`, `''`, and an object left holding only those collapse to *no settings* — so
the question is asked properly. And an edited row is offered only when it has something showable,
so if the two tests ever drift again the result is a missing row rather than an unanswerable one.
A silent row is the safer failure: the merge still happened, and the timeline is still the merged
one.

### The words: published, and mine

**[P14]** Settled 2026-11-11, after driving the whole flow by hand. Three vocabularies had been
tried and all three failed in testing, so this one is written down rather than left to each
component.

| Don't say | Say | Why |
|---|---|---|
| "In your account" | **Published** | An account is where the record happens to live; *published* is what the reader cares about |
| "In this browser" | **Drafts**, with "kept in this browser only" as a note under it | The place is a caveat, not the name of the thing |
| "Set aside" / "your copy" / "the timeline" | **An unmerged draft**, against **the published timeline**; short forms **Published** and **My draft** | "Set aside" named where the edits were kept, not what they were, so no button built on it could be read |
| "Take this" / "Bring this over" | **Keep mine** / **Keep published** | *Take* points in whichever direction the reader imagines standing — and here the thing being "taken from" is the one with priority, which inverts it again |

The same two words run through the column heads, the stacked-value tags, the per-field buttons and
the whole-row buttons, so a row never asks anyone to re-derive which side they are looking at.
Where keeping yours means adding or deleting a whole slide the label says so outright (*Keep mine —
delete the slide*): that is the one case worth a second of warning.

*Judgement call, strike it if you disagree:* the left column says **Published** when strictly it is
the working document — the published version plus anything typed since opening it. Saying that
exactly costs a clause on every row and buys nothing in the usual case, where nothing has been
typed since.

### An unmerged draft is a task, not an archive

**[P15]** The panel used to reassure: *"keeping what the timeline has leaves your set-aside edits
untouched."* True, and the wrong thing to say — it implied there was lasting value in holding on to
the draft, when the whole design wants it answered and gone. The text now points one way: each
answer takes a row off the list, an empty list means the draft has done its job, and the panel and
the editor's line both offer to delete it.

Keeping a draft to read later was considered and rejected, short of flagging contested fields
inside it. An unmerged draft carries no marks saying which parts disagreed with the published
version, so reading one later tells you nothing you could act on; and flagging the fields would
mean re-running the three-way analysis inside the editor and painting it onto the UI, which is a
large amount of machinery for a case nobody has asked for. *Open my draft instead* stays, because
unmatchable slides can only be reached that way.

## Deliberately not decided here

- **Phase 2 wording, and more than wording.** Once a server holds drafts, "published from another
  device" mostly means "a collaborator published", and that copy is not written here. The *conflict*
  mechanism is genuinely unchanged — the published record remains the only thing that can disagree.
  But this line used to say the mechanism was unchanged full stop, and that was wrong: seeding the
  shared document, and reconciling the local drafts that predate it, are real Phase 2 work. See
  *Joining an existing server draft*.
- **Other people's timelines.** Everything here assumes the owner's own records. A collaborator
  cannot publish, so they never hit Script 6.
- **Checking in the background** while a draft is open. It is useful and possible, but polling is its
  own decision; this spec checks on open and on publish only.

---

## Asks

All four answered 2026-10-27, each as its default.

| | Ask | Answered |
|---|---|---|
| A1 | When only the published version changed, update quietly with a dismissible note, or ask first? | **Update, with a quiet note.** Nothing local is at risk, so a prompt would spend a modal on a non-decision |
| A2 | With unambiguous merges now automatic ([P9]), should the choice shown for a real collision include a per-slide merge UI, or only Keep mine / Use published / Keep both? | **The three, without a merge UI.** The per-slide work goes in the pull-list after *Keep both* ([P12]) |
| A3 | Which option in the conflict choice gets the emphasis? | ***Keep both*** — the only choice that cannot lose work |
| A4 | Is a fork shown attached to its original as an open task, or as its own row in the list? | **Attached**, with a **Reconcile** action; a free-floating row gets deleted or published by accident |

## Decisions I made

| | Decision | Revisit if |
|---|---|---|
| P1 | Detect change by CID, never by timestamp | |
| P2 | Store the base CID beside `publishedSnapshot`, written together | |
| P3 | Publish with `swapRecord` so the overwrite check is atomic on the server | A PDS implementation mishandles `swapRecord` |
| P4 | Opening a published timeline reuses its existing local draft — **shipped, `536221b`** | |
| P5 | One home-screen row per timeline, using `listRecords` CIDs — **shipped** | Merged rows prove harder to read than two lists |
| P6 | Describe the conflict as a three-way, loss-framed per option, with the overlap as the key fact | |
| P7 | ~~Offer a preview of the published version, opened at the first contested slide~~ — **struck**: not cheap, and overtaken by the side-by-side comparison | Someone asks to see the published version as a timeline rather than as fields |
| P8 | `listTimelines` carries each record's CID; `createdAt` is for display only, never detection | |
| P9 | Merge automatically when the overlap is empty; ask only on a real collision | Silent merges surprise people in testing |
| P10 | A fork is not a publish claim: no `atUri` in the index, publish-blocked by default | |
| P11 | A fork carries `forkedFrom` — atUri, base CID, base snapshot — not just content | |
| P12 | Reconciliation is an asymmetric pull-list against the working document, not a merge screen | The overlap turns out to be large often enough that symmetric merging earns its keep |
| P13 | A browser joining a server draft connects empty; an existing local draft is reconciled, never attached | |
| P14 | One vocabulary everywhere: **published** vs **mine**; "set aside" and "take" are gone | A test reader reads the left column as literally the published record when they have edited since |
| P15 | An unmerged draft is a task to finish, never an archive to keep; nothing in the UI suggests keeping one | Someone actually wants to read an old draft, which would mean flagging contested fields inside it |
| P16 | Settings equality normalizes the ways of writing "nothing"; an edited row is offered only when it has a showable difference | A real change is ever found that no field can render |
| P17 | Every line carries both choices; a line is offered only where the draft itself changed something | Rows grow long enough that two buttons a line is more noise than help |
| P18 | `settings.ogImage` is outside every comparison and every pull: regenerated on each publish, so never a choice | The share image becomes author-set rather than generated |
| P19 | A row's kind is its effect on the working document; a slide both sides invented says so in its own words | |
| P20 | An unmerged draft never blocks publishing; it is said before the write instead | People are found publishing over work they meant to merge, despite the warning |
| P21 | One ✕ meaning "delete this timeline"; instant with undo when private, confirmed when public | Someone deletes a published timeline they meant to keep, despite the confirmation |
| P22 | Ownership comes from the record's DID, never from keying storage by account; other accounts' rows are labelled, not hidden, and left out of the comparison | Shared-browser privacy ever outweighs losing sight of your own work |
