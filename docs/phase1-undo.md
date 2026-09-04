# Undo: interaction script

**Status: accepted 2026-09-04**, without changes. Resolves Q11 of
[coauthoring.md](coauthoring.md); this document is now the spec Phase 1 builds to.

The decisions table at the end stays as the record of what was chosen and what would justify
revisiting it. Items marked *(feel)* were accepted provisionally — they can only really be judged
against running code, and changing one later is not a reopening of this spec.

## How to read this

This is an *interaction script*, not a mockup. Undo reuses screens that already exist — the slide
list, the event editor, the settings panel — so there is almost no new visual surface to draw. What
is undecided is **sequencing and focus**: what moves, in what order, and where the user's attention
lands. Prose is the right resolution for that, and a picture would mostly smuggle in decisions
nobody made.

Each numbered beat is one observable step. Strike out anything you disagree with; that is the point
of the format. Choices I made rather than derived are tagged **[D*n*]** and listed together at the
end, so they are easy to find and easy to overrule.

Some of this can only be settled by feel — how long a flash lasts, whether a scroll is jarring. Those
are marked *(feel)* and want a prototype, not a review.

---

## The rule

Every prior tool converges on the same three beats, and nothing here argues with them:

> **Reveal, then apply, then flash.**

Never mutate something the user cannot see. If the target is off screen, bring it on screen first,
*then* change it, *then* mark what changed. The ordering matters: applying before revealing makes the
change look like it happened somewhere else, which is exactly the disorientation we are trying to
avoid.

## Scope

**[D1] One global undo stack for the whole timeline, not one per slide.**

The alternative is the VS Code model — undo scoped per slide, so Cmd-Z in slide 4 can never touch
slide 7. It is tempting because it makes undo trivially predictable. It is wrong here because slides
are not documents: adding, deleting and reordering are timeline-level acts with no slide to belong
to, and a per-slide stack would have to special-case all of them into a second global stack anyway.
Two stacks with a seam between them is worse than one stack that explains itself.

The cost of going global is precisely the reveal problem, which is what the rest of this document is
about.

**Not a choice:** with Tiptap's `Collaboration` extension there is exactly one history implementation
in the app — `StarterKit.configure({ undoRedo: false })`, and Yjs's `UndoManager` takes over. There is
no separate in-field undo to reconcile.

**[D2] `captureTimeout` stays at the Yjs default (500ms).** Typing coalesces into one undo step per
burst rather than per keystroke. Revisit by feel. *(feel)*

---

## Script 1 — the change is on the current slide, in view

The common case, and it should be unceremonious.

1. User presses Cmd-Z (Ctrl-Z).
2. The change applies.
3. The affected field flashes — a brief background tint, ~400ms, then fades. *(feel)*
4. Focus does not move. If the user was typing in the headline, they are still in the headline.

**[D3] No toast, no announcement, no undo counter.** For a visible change, the change itself is the
feedback.

## Script 2 — the change is on the current slide, scrolled out of view

The editor pane scrolls; media fields sit well below the headline.

1. User presses Cmd-Z.
2. The editor pane scrolls the affected field into view. Smooth, not instant. *(feel)*
3. The change applies.
4. The field flashes.
5. Focus moves to the affected field.

**[D4] Focus moves here but not in Script 1.** In Script 1 the user is already looking at the right
place and stealing focus would interrupt typing. Here they are not, and focus is how they resume.

## Script 3 — the change is on a different slide

1. User presses Cmd-Z.
2. The slide list selects the target slide. If the list is collapsed (`showEventList` is false), it
   opens. **[D5]**
3. The editor pane switches to that slide.
4. If the affected field is below the fold, the pane scrolls to it (Script 2 beats 2–5).
5. The change applies.
6. The field flashes.
7. Focus moves to the affected field.

**[D6] No confirmation prompt before navigating away.** The current slide has no unsaved state of its
own — edits are already in the document — so there is nothing to lose, and a prompt on every
cross-slide undo would be intolerable.

## Script 4 — the change was a slide deletion

Already solved in the app, and the existing behaviour wins.

1. User presses Cmd-Z.
2. The slide reappears in the list **at its own sorted position**, which is what
   `EventList.svelte` already does for the timed restore affordance.
3. The list scrolls it into view if needed.
4. The restored row flashes.
5. **[D7] The slide is selected and the editor switches to it.** This differs from the current
   timed-undo affordance, which restores without selecting. Undo is a deliberate act and should land
   the user on the thing they recovered.

The existing timed "restore" row stays as it is — it serves a different moment (immediately after
deleting, without reaching for a keyboard shortcut) and the two can coexist.

## Script 5 — the change was to timeline settings

1. User presses Cmd-Z.
2. The settings panel opens if it is closed.
3. The change applies.
4. The affected control flashes.
5. Focus moves to it.

**[D8] Settings share the same stack as slides.** A user who changes a font, edits a slide, then hits
Cmd-Z twice expects the font change back. Keeping settings on a separate stack would technically be
tidier and would surprise everyone.

## Script 6 — an overlay is open

The Publish panel and the Preview overlay both cover the editor.

1. User presses Cmd-Z while the Publish panel or Preview is open.
2. **[D9] The overlay closes first.** Then the appropriate script above runs from beat 1.

Rationale: undo always acts on the document, and the document is behind the overlay. Undoing
invisibly while a panel covers the evidence is the worst version of this feature.

## Script 7 — nothing left to undo

1. User presses Cmd-Z with an empty stack.
2. Nothing happens. **[D10] No error, no toast, no shake.** Every other editor is silent here.

---

## Redo

Redo is the mirror of each script above, with the same reveal-then-apply-then-flash ordering. It is
not separately specified because no beat differs except the direction.

## Deliberately not decided here

- **Whether undo is announced to screen readers, and how.** A live region saying "undid: headline
  change on slide 4" is probably right, but it needs a pass with the a11y roadmap rather than an
  inline guess here.
- **Whether the flash colour differs for undo vs. redo.** Probably not. Cheap to try. *(feel)*
- **Anything about collaborator undo.** Phase 2. `trackedOrigins` is set in Phase 1 so that a user's
  undo only ever touches their own operations, but the multi-user experience — seeing someone else's
  edit arrive while your undo stack is mid-flight — is out of scope for this document.

## Decisions, collected

| | Decision | Overrule if |
|---|---|---|
| D1 | One global stack | You want undo to never cross slides, and accept a second stack for structural acts |
| D2 | 500ms capture timeout | Typing bursts group wrongly in practice |
| D3 | No toast for visible changes | You want undo to be explicitly confirmed every time |
| D4 | Focus moves only when the view had to move | You want focus behaviour uniform |
| D5 | Collapsed slide list auto-opens | You would rather the panel state never change under the user |
| D6 | No prompt before cross-slide navigation | |
| D7 | Undoing a delete also selects the slide | You want undo to restore without moving the user |
| D8 | Settings share the slide stack | |
| D9 | Overlays close before undo applies | |
| D10 | Silence on an empty stack | |
