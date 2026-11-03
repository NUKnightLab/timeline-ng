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

What remains: [P12]'s pull-list, which is what makes *Keep both* a deferral rather than a trap — a
fork today can be opened and read but not reconciled, and says so instead of offering a Reconcile it
cannot honour. Then [P7]'s preview at the first contested slide, [P6]'s field-level fidelity inside
contested slides, and [P5]'s one-row-per-timeline presentation. The status span also still replaces
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

**[P5]** The home screen shows **one row per timeline**. At the moment a published timeline with a
local draft appears in both lists. `listRecords` already returns each record's CID, so a row can say
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

**[P7]** Offer **Preview the published version**, opened at the first contested slide. A timeline is a
visual artifact and a prose change list is a poor proxy for one. This is nearly free: the preview
harness already accepts an arbitrary timeline object — `EditorView.svelte` posts
`{ type: 'tl-preview', timeline, initialIndex }` and the embed handles it — and nothing binds it to
the document being edited.

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
| P5 | One home-screen row per timeline, using `listRecords` CIDs — **partly overtaken by P4**; what remains is presentation | Merged rows prove harder to read than two lists |
| P6 | Describe the conflict as a three-way, loss-framed per option, with the overlap as the key fact | |
| P7 | Offer a preview of the published version, opened at the first contested slide | It turns out to be read past rather than used |
| P8 | `listTimelines` carries each record's CID; `createdAt` is for display only, never detection | |
| P9 | Merge automatically when the overlap is empty; ask only on a real collision | Silent merges surprise people in testing |
| P10 | A fork is not a publish claim: no `atUri` in the index, publish-blocked by default | |
| P11 | A fork carries `forkedFrom` — atUri, base CID, base snapshot — not just content | |
| P12 | Reconciliation is an asymmetric pull-list against the working document, not a merge screen | The overlap turns out to be large often enough that symmetric merging earns its keep |
| P13 | A browser joining a server draft connects empty; an existing local draft is reconciled, never attached | |
