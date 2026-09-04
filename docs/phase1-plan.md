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

**[A1]** In user terms the two outcomes are: undoing an edit to the slide you are looking at either
updates that field in place with your cursor undisturbed, or re-renders the whole slide-editor panel
and loses your cursor position and scroll. The first is the plan. The second is the escape hatch if
this proves as awkward as it might. The ask is only whether taking the escape hatch is something to
raise at the time or just get on with.

---

## Stages

Each stage is independently verifiable and independently committable. The app stays working at every
boundary. **[P3]** Stages 0–2 do not change any behaviour a user can see, which is deliberate: the
risky structural change lands under a green test suite before any feature rides on it.

### Stage 0 — the document module

Add `yjs`, `y-indexeddb`, `y-prosemirror`, `@tiptap/extension-collaboration`.

New `lib/doc.ts`, plain TypeScript, no Svelte: the §3.2 schema (`slides: Y.Map<Y.Map>`,
`settings: Y.Map`, `meta: Y.Map` for title and `atUri`), plus `createDoc()`,
`docToTimeline(doc): TLTimeline` and `loadTimeline(doc, tl)`.

*Verify:* vitest round-trips — every fixture timeline through the doc and back, deep-equal to the
original. No UI involvement, so failures are unambiguous.

### Stage 1 — the snapshot bridge

New `lib/doc.svelte.ts`: observe the doc, rebuild plain `$state` in the shapes App.svelte already
uses (`events: TLEvent[]`, `titleEvent`, `settings`). App.svelte swaps its `$state` declarations for
the bridge; the mutation functions now write to the doc instead of reassigning arrays.

**[P4]** `pdsClean` becomes derived from the document rather than a flag set by hand at seven call
sites. It is the same information, computed instead of remembered.

*Verify:* the app behaves exactly as before. Existing tests pass, plus a manual pass over add /
edit / delete / settings / save.

### Stage 2 — field-level writes

The diff adapter described above. `applyEventUpdate(doc, key, updated)` writes only what changed.

*Verify:* unit tests asserting that a headline-only edit produces exactly one field write, and that a
no-op emit produces none.

### Stage 3 — rich text on `Y.XmlFragment`

Wire `Collaboration` into `RichTextEditor`, with `StarterKit.configure({ undoRedo: false })`. Maintain
the derived HTML mirror on the same transaction. Exclude these fields from the Stage 2 adapter.

**[A2]** Headline and body become fragments; **media caption and credit stay plain LWW strings** —
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
  migrating documents (§3.2). Nothing planned, but Stage 3 is the point of no return.

## Gates

Places to stop and confirm rather than press on: after **Stage 1** (the model is swapped, nothing
looks different — the moment to confirm nothing regressed), after **Stage 3** (the point of no
return on the schema), and after **Stage 5** (before undo, everything else is done and shippable).

## Asks

Two, both judgeable without reading any code.

| | Ask | Default if you have no view |
|---|---|---|
| A1 | If keeping the cursor steady during same-slide undo proves as awkward as it might, is falling back to "the panel re-renders and you lose your place" worth raising at the time, or just my call? | Raise it, since it is a visible downgrade |
| A2 | Should photo captions and credits merge properly between two simultaneous editors, or is last-write-wins fine for them? | Last-write-wins; promote later if wrong |

## Decisions I made

Recorded so they are visible, not because they need your attention.

| | Decision | Revisit if |
|---|---|---|
| P1 | A diff adapter rather than rewriting EventEditor | The translation layer starts leaking into components |
| P3 | Stages 0–2 ship no visible change | You want something demoable sooner |
| P4 | `pdsClean` becomes derived from the document | |
| P6 | Migrate any existing `tl-draft-v1` rather than dropping it | |
