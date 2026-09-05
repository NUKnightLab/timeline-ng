# Phase 1 implementation plan: adopt Yjs locally

**Status: proposal, for markup.** Written 2026-09-04. Branch: `phase1-yjs`.

Implements Phase 1 of [coauthoring.md](coauthoring.md) §9, to the document model in §3.2 and the
undo spec in [phase1-undo.md](phase1-undo.md). Single user, no server, no collaboration.

Two kinds of judgement call are tagged and collected at the end, kept apart because they need
different things from a reader: **[A*n*]** are asks — choices with consequences you can judge without
reading the code, and which I should not make alone. **[P*n*]** are mine — engineering calls,
recorded so they are visible and reversible, but not questions. Skip the P table unless something
downstream looks wrong.

## What ships

- Undo/redo, per the undo spec
- Several local drafts instead of one, with a drafts list
- Multi-tab safety, and offline editing as a side effect
- The §3.2 document model, which is what makes Phase 2 a provider swap

## What does not

No server, no network sync, no presence, no sharing, no change to the published record, no change
to the player or embeds. Publishing keeps writing the same single `com.knightlab.timeline` record it
writes today.

---

## Two things the code says that the design doc does not

Findings, not questions — this section is here to explain why the stages are shaped the way they
are. Both came out of reading the editor.

### EventEditor emits whole slides, ~25 times over

`EventEditor.svelte` holds about twenty-five local `$state` fields and rebuilds the entire `TLEvent`
in `buildAndEmit()`, which is called from ~25 places — every keystroke in the headline included.
Handed straight to a `Y.Map`, that is a whole-slide replace per keystroke: last-write-wins with a
CRDT underneath it, which is precisely the failure §3.2 warns about.

The fix is *not* to rewrite EventEditor. **[P1]** Instead, `updateEvent` gains an adapter that diffs
the emitted `TLEvent` against the slide's current `Y.Map` and writes only the fields that actually
changed, inside one transaction. EventEditor — the largest file in the project at 2,069 lines — is
untouched, and all the CRDT knowledge lives in one testable function.

The rich-text fields are the exception, and they get *better* treatment: once Tiptap's
`Collaboration` extension is wired, Tiptap writes to the `Y.XmlFragment` directly and never goes
through `buildAndEmit` at all. So the adapter must **exclude** those fields from its writes. That
seam is the whole design: structured fields merge per-field through the adapter, prose merges
per-character through Tiptap.

### EventEditor cannot currently receive a change

`EditorView.svelte:445` wraps the editor in `{#key selectedId}`, and its `$state` fields initialise
from the `event` prop once at mount. Changing a slide's data underneath the editor does nothing to
what is on screen. That is fine today — the editor is the only writer — but:

- **Undo Scripts 1 and 2 need it.** Undoing a change to the slide you are looking at has to update
  the field you are looking at.
- **Phase 2 needs it** for a collaborator's edit to appear at all.

So this is real Phase 1 work, not a Phase 2 concern, and it is the hardest single piece. The
approach: make the editor's fields derive from the document snapshot, with a local override while a
field has focus so that incoming changes never fight the user's cursor. Rich-text fields sidestep it
entirely, since Tiptap binds to the fragment directly.

**[A1 — answered: raise it]** In user terms the two outcomes are: undoing an edit to the slide you
are looking at either updates that field in place with your cursor undisturbed, or re-renders the
whole slide-editor panel and loses your cursor position and scroll. The first is the plan; the second
is the escape hatch. If the escape hatch gets taken, say so at the time rather than quietly.

---

## Stages

Each stage is independently verifiable and independently committable. The app stays working at every
boundary. **[P3]** Stages 0–2 do not change any behaviour a user can see, which is deliberate: the
risky structural change lands under a green test suite before any feature rides on it.

### Stage 0 — the document module ✅

Add `yjs`, `y-indexeddb`, `y-prosemirror`, `@tiptap/extension-collaboration`.

New `lib/doc.ts`, plain TypeScript, no Svelte: the §3.2 schema (`slides: Y.Map<Y.Map>`,
`settings: Y.Map`, `title: Y.Map`, `meta: Y.Map` for the timeline title and `atUri`), plus
`createDoc()`, `docToTimeline(doc): TLTimeline` and `loadTimeline(doc, tl)`.

**[P7] Internal keys land here, not in Stage 4.** Keying the map by an internal id costs nothing in
this module — the work in Stage 4 is threading `selectedId` through App, EventList and EditorView,
which is entirely UI. Building Stage 0 on `unique_id` keys would mean writing it twice.

**[P8] Object-valued fields are nested `Y.Map`s** — `start_date`, `end_date`, `text`, `media`,
`background` — so that a caption and a credit on one slide merge independently. `blobRef` is the
exception and is stored whole: it is a content-addressed reference whose parts are meaningless
apart. Rich text stays a plain string until Stage 3 converts it.

*Verify:* vitest round-trips — every fixture timeline through the doc and back, deep-equal to the
original. No UI involvement, so failures are unambiguous.

### Stage 1 — the snapshot bridge ✅

New `lib/doc.svelte.ts`: observe the doc, rebuild plain `$state` in the shapes App.svelte already
uses (`events: TLEvent[]`, `titleEvent`, `settings`). App.svelte swaps its `$state` declarations for
the bridge; the mutation functions now write to the doc instead of reassigning arrays.

**[P4]** `pdsClean` becomes derived from the document rather than a flag set by hand at seven call
sites. It is the same information, computed instead of remembered.

*Verify:* the app behaves exactly as before. Existing tests pass, plus a manual pass over add /
edit / delete / settings / save.

### Stage 2 — field-level writes ✅

The diff adapter described above — which turned out to be almost entirely delivered already, by the
no-op write guards Stage 0 needed for a different reason (stopping the title-sync effect looping).
Measured before implementing: a headline-only edit already touched exactly `text/headline`.

The one real leak was `blobRef`. It is the only object-valued field the editor emits, so it arrived
as a fresh object each time and failed a referential guard, meaning it was rewritten on every
keystroke anywhere on the slide. Fixed by making the guard structural rather than referential
(`sameValue` in `doc.ts`), which is a dozen lines rather than the separate `applyEventUpdate`
adapter this plan imagined.

So there is no translation layer to carry after all, and **[P1] costs less than advertised**: the
whole-event emit from `EventEditor` is safe as written, and the 2,069-line editor stays untouched.

*Verified:* `docdiff.test.ts` — a re-emit with freshly constructed nested objects writes nothing at
all; a headline edit, a caption edit, a date part, a rename and a removed sub-field each write
exactly one field.

### Stage 3 — rich text on `Y.XmlFragment`

Wire `Collaboration` into `RichTextEditor`, with `StarterKit.configure({ undoRedo: false })`. Maintain
the derived HTML mirror on the same transaction. Exclude these fields from the Stage 2 adapter.

#### Migration strategy

"Schema changes become migrations" is the scariest line in this plan, so it is worth being precise
about what is actually at risk.

**Published timelines are never at risk.** The record on the PDS stays HTML (§3.1) — a
`Y.XmlFragment` exists only inside a draft document, and the derived HTML string is what gets
published. No schema change can break a published timeline, an embed or the player. The blast radius
is live drafts and nothing else.

**That population is bounded and self-expiring.** In Phase 1 drafts are local to one browser and
last as long as someone is working. From Phase 3 they are server-held under a 90-day retention
(§10.5), so any document predating a schema change ages out on its own.

**Most changes need no migration.** Adding a mark or a node type is additive: existing documents do
not contain it, and the new schema accepts everything the old one produced. That covers the realistic
cases — highlight, strikethrough, superscript.

#### Remediation strategy

Surprises are certain, so what matters is what we can detect and what we can put back. Three assets,
and one operational rule.

**The published record is untouched HTML on the owner's PDS.** For any timeline that has ever been
published, the original prose exists in a form nothing in this plan can damage — re-importing it
restores the text exactly. That is the backstop behind everything below, and the reason §10.7's
invariant (the player never depends on our service) is worth defending for more than uptime.

**The HTML mirror is a rebuild path.** Parsing HTML into a fragment is lenient and keeps text, even
for markup the schema does not know — a table flattens to a paragraph reading `Apollo1969`, a
definition list becomes two paragraphs. So `rebuildFragmentFromHtml` can always recover a fragment
from its mirror, and a schema migration is a safe operation.

**A field that cannot be a fragment keeps working.** `ensureFragments` declines rather than forces:
if seeding throws, comes back empty, loses text, or would drop embedded content, that field stays
plain HTML owned by `writeSlide` — the pre-Stage-3 behaviour. It gives up merging and loses nothing.
This is what protects the case that actually bites, which is not exotic markup but an ordinary
`<img>` or `<iframe>` in body prose: ProseMirror is allowlist-only, and those carry no text to
degrade into, so they vanish outright.

**The rule: never narrow a schema without rebuilding fragments from mirrors first.** Reading an
existing fragment under a narrower schema destroys content silently — no error, no text left behind.
Parsing the same markup does not. So a narrowing migration must rebuild from the mirror *before* the
new schema is ever used to read a stored fragment, and `schemaVersion` is what tells a client which
of those two situations it is in. Widening a schema is free and needs none of this.

What remains genuinely unprotected is an **unpublished draft** whose prose was never on a PDS. The
guards above mean nothing can be lost while seeding or editing, since the schema is fixed for the
life of a document — but there is no external copy to recover from, which is another way of saying
the retention window (§10.5) is the only backstop a draft has.

**There is more than one schema.** `RichTextEditor`'s `minimal`, `inlineOnly`, `singleLine` and
`noLink` props do not merely hide toolbar buttons — they pass `false` to StarterKit extensions and to
`Link`, so each configuration is a different ProseMirror schema. Since [A2] keeps caption, credit and
alt as plain strings, exactly two of them become fragments:

| Field | Config | Schema |
|---|---|---|
| Body `text.text` | none | Full StarterKit + Link — headings, lists, blockquote, code block, rule, strike, code, hard break, bold, italic, underline, link. Nothing here is prohibited that StarterKit offers. |
| Headline `text.headline` | `inlineOnly singleLine` | Paragraph, text, bold, italic, underline, strike, link. No inline code. |

Inline marks default to **author freedom**: every mark StarterKit offers is available everywhere,
with one deliberate exclusion — inline `code` in a headline, which there is far more often a paste
artefact than an intention. Block structure is a different matter and stays excluded from headlines
and captions, since removing it is what those configurations are for.

Two consequences. Each field must always be bound to the editor configuration that wrote it, which
holds today because the configuration is fixed per field in `EventEditor` — but it is now an
invariant rather than an accident. And the headline schema is a strict *subset* of the body schema,
so relaxing a headline restriction later is additive and free; tightening one needs a rebuild.

One correction to an earlier version of this section, which claimed headlines already discarded
links. They did not. **StarterKit v3 bundles the Link extension itself**, so `noLink` — which only
omitted a *separately added* `Link` — removed nothing from the schema; it dropped `autolink` and
nothing else. Headlines have accepted links all along.

Given the choice between making the restriction real and dropping it, the freedom default settles
it: **links stay allowed everywhere**, and the `noLink` prop is gone rather than left in place doing
nothing, which is exactly how the confusion arose. Enforcing it would have stripped anchors out of
headlines people have already published — a real cost against a stylistic preference. Stage 3
therefore changes no content at all.

Inline code in a headline genuinely was and remains excluded.

Strikethrough used to be in that list and no longer is. It had been swept up with the block-level
exclusions — `heading`, `blockquote`, lists, `codeBlock`, `horizontalRule` — where dropping it makes
obvious sense, but strike is an inline mark and `inlineOnly` is about removing block structure. The
body has always preserved pasted strikethrough; a headline dropping it was inconsistent rather than
decided. Enabling it before Stage 3 means the two fragment schemas differ only where they differ on
purpose. (No configuration offers a toolbar button for strike, in the body either — this is about
what survives paste and import.)

**For the rest, the derived HTML mirror is the migration mechanism.** Discard the fragment, re-parse
its HTML with the new schema, write a fresh fragment. That is exactly what `RichTextEditor` already
does on every load today, so it is a well-trodden path rather than new machinery. This is worth
noticing: the mirror was introduced to keep the ProseMirror schema out of the publish layer
(§10.6), and it turns out to be the reason schema changes stay recoverable at all. It earns its
keep twice.

What a rebuild costs is the CRDT history for that field — its edit history and its undo stack, not
its content. For a schema migration that is an acceptable trade, and it is why a migration should
run at load, when nobody else is editing that document.

Two things follow, and both are cheap now and awkward later:

**One case has no load-time hook**, though it is unlikely enough not to shape the design. Everything
above assumes a document is opened, found stale and rebuilt. Two clients running *different app
versions* against one document skip that: the newer writes a mark the older has never heard of, and
the older receives it over the wire with the document already open.

Note what that does to Case 1 — an *additive* change, the free direction for stored documents, is
precisely what causes it.

The probability is low, because the app is a hosted page and everyone reloads into the same build;
Vite content-hashes its assets, so stale caching is not the vector. The vector is a tab left open
across a deploy, which is somewhat more plausible in Phase 2 than elsewhere, since co-authoring
sessions are exactly when a tab stays open all afternoon.

Not worth engineering around, but worth a cheap guard: the Phase 2 provider should carry a schema
version at connect and prompt a reload on mismatch. Which means `schemaVersion` is not only a
migration stamp — it is the value that handshake compares.

Two things follow, and both are cheap now and awkward later:

- **[P9] Stamp a `schemaVersion` in `meta` from Stage 3**, even though nothing reads it yet.
  Retrofitting a version stamp onto documents that do not carry one is the genuinely painful part of
  any migration, and Phase 2's connect handshake needs the same value. Writing one costs a line.
  Same argument as `trackedOrigins`.
- **[P10] The mirror is derived from the fragment, never from an editor.** Two reasons, and the
  first was not obvious. Concurrent edits to one field produce a fragment that merges correctly,
  but each client would compute the mirror from its own view and write it to the same string key —
  last write wins, so the mirror ends up holding one author's text while the fragment holds the
  merge, and the published paragraph disagrees with the one on screen. Second, `UndoManager` mutates
  fragments directly with no editor involved, and undo routinely lands on a slide other than the one
  displayed (phase1-undo.md, Script 3), so frequently there is no editor to derive from. An earlier
  version of this said "written in the same transaction", which is neither achievable through
  Tiptap's update hook nor sufficient.

**Confirmed, and it is the bad answer.** A fragment containing a node the reading schema does not
know **loses that node and everything inside it, silently**. Measured: a body of
`<blockquote><p>Quoted.</p></blockquote><p>After.</p>` read under the headline schema comes back as
`<p>After.</p>`. Nothing throws; the quoted sentence is simply gone.

Note the asymmetry, because it is what makes the migration path safe while leaving the read path
sharp. *Parsing* that markup under the headline schema flattens it to `<p>Quoted.</p>` and keeps the
words. Only reading an existing fragment discards them. So rebuilding from the HTML mirror is a safe
migration, and reading a fragment with the wrong configuration is silent data loss with no error to
notice.

Two consequences. `RICH_TEXT_FIELDS` in `doc.ts` must stay the single place the field-to-
configuration mapping is recorded — a field read with a configuration other than the one that wrote
it destroys content. And `schemaVersion` stops being bookkeeping: it is the only thing that can tell
a client its stored fragments predate the schema it is about to read them with.

Two related failure modes were fixed alongside, both now covered by `failure.test.ts`:

- **Yjs does not roll back a transaction whose callback throws** (measured: a map keeps both writes
  made before the throw). A slide whose prose cannot be parsed would therefore have left a half-built
  document. `ensureFragments` now declines to keep a fragment it could not seed — and also declines
  one that came back empty from non-empty HTML — so that field degrades to its pre-Stage-3
  behaviour, HTML owned by `writeSlide`, text still on screen and still publishable.
- **HTML is sanitized before it is parsed** into a fragment. The schema would reject anything
  dangerous on the way in, but parsing assigns `innerHTML` on a real element, and a detached node is
  not a guarantee in every browser.

**[A2 — answered: last-write-wins]** Headline and body become fragments; **media caption, credit and
alt stay plain LWW strings** —
if two people edit one caption at the same time, the later edit wins outright rather than merging.
They are short and single-author in practice, and four fragments per slide is a lot of machinery for
a photo credit. Easy to promote later if that turns out wrong.

*Verify:* the first real proof of merge — two `RichTextEditor` instances bound to the same fragment
in one page, typed into simultaneously, converging without loss.

### Stage 4 — internal keys

Key the slide map by an internal id; demote `unique_id` to an ordinary field. Touches `selectedId`
throughout App.svelte, EventList, EditorView, and the `'title'` sentinel.

A payoff worth noting: the slide-ID field currently commits on blur rather than on input, precisely
*because* it doubles as the parent's identity key (there is a comment at `EventEditor.svelte:255`
explaining this). Once it is an ordinary field, that constraint disappears.

*Verify:* rename a slide ID while typing, with no remount and no focus loss. Round-trip tests from
Stage 0 still pass.

### Stage 5 — persistence and the drafts list

`y-indexeddb` per document. A local drafts list in `HomeView`. **[P6]** Migrate any existing
`tl-draft-v1` into the new store on first load rather than discarding it — some people have unsaved
work in there right now.

*Verify:* two tabs on one draft converge; reload restores; an existing `tl-draft-v1` survives the
upgrade.

### Stage 6 — undo

`UndoManager` with `trackedOrigins` set, then the seven scripts. Depends on Stages 3, 4 and 5, and on
the **[A1]** work, which is why it is last.

*Verify:* each script by hand, since they are about sequencing and focus. The *(feel)* items in the
undo spec get judged here.

---

## Risks

- **[A1] is the schedule risk.** Making a 2,000-line editor accept incoming changes without
  disturbing a typing user is the part most likely to take longer than it looks. It is also
  unavoidable — undo requires it. If it turns ugly, the fallback is to remount the editor on external
  change and accept focus loss for same-slide undo, which is bad but shippable.
- **`$effect` loops.** Writing to the doc from an effect that observes the doc. Mitigated by keeping
  all writes in explicit event handlers and never in effects, which is already how App.svelte is
  written.
- **Bundle size.** Yjs plus y-prosemirror plus the Tiptap extension. Authoring is already the heavy
  bundle and is not embedded anywhere, so this is worth measuring but unlikely to matter.
- **Stage 3 schema lock-in.** Once prose is stored as ProseMirror nodes, changing the schema means
  migrating documents (§3.2) — but only *draft* documents, and the HTML mirror gives every one of
  them a rebuild path. See the migration strategy above; this is a smaller risk than it first reads.

## Gates

Places to stop and confirm rather than press on: after **Stage 1** (the model is swapped, nothing
looks different — the moment to confirm nothing regressed), after **Stage 3** (the point of no
return on the schema), and after **Stage 5** (before undo, everything else is done and shippable).

## Asks

Two, both judgeable without reading any code.

| | Ask | Answered |
|---|---|---|
| A1 | If keeping the cursor steady during same-slide undo proves awkward, is falling back to "the panel re-renders and you lose your place" worth raising at the time? | **Yes, raise it** — assumed to be for good reasons, but say so |
| A2 | Should photo captions and credits merge between simultaneous editors, or is last-write-wins fine? | **Last-write-wins.** Alt text too, which is already a plain textarea and needs no change |

## Decisions I made

Recorded so they are visible, not because they need your attention.

| | Decision | Revisit if |
|---|---|---|
| P1 | A diff adapter rather than rewriting EventEditor | The translation layer starts leaking into components |
| P3 | Stages 0–2 ship no visible change | You want something demoable sooner |
| P4 | `pdsClean` becomes derived from the document | |
| P6 | Migrate any existing `tl-draft-v1` rather than dropping it | |
| P7 | Internal keys land in Stage 0, not Stage 4 | |
| P8 | Nested `Y.Map`s for object fields; `blobRef` stored whole | Sub-field merging turns out not to be worth the read/write cost |
| P9 | Stamp `schemaVersion` in meta from Stage 3, unread | |
| P10 | The HTML mirror is written in the same transaction as the fragment | |
