# timeline-ng Roadmap

Based partly on an AI review of 200 open TimelineJS3 GitHub issues (harvested 2026-06-26) plus launch-planning notes.
Where TL3 issues are cited, the number links back to the original for detail.

---

## 1. Accessibility

**No closed-caption support for video.** `TLMedia` has no `captions`/`vtt` field, and
   the native `<video>` has no `<track>`; hosted embeds (YouTube etc.) rely on the
   platform's own CC UI. Needs a schema field + authoring UI + passthrough — **medium**
   complexity, candidate for a fast-follow rather than blocking launch. — TL3 #624

**Authoring app a11y: dialogs that never took focus, and placeholder links — done.**
   The three `href="#"` anchors are now `<button type="button">` — one in
   `HomeView.svelte` ("Clone our example timeline"), two in `EventEditor.svelte`
   ("Learn more"). Each already called `preventDefault` and acted in place, so they
   took focus and announced as links that went nowhere. Orangeline styles every
   `<button>`, so each carries an explicit reset back to link appearance rather than
   inheriting margin, text-transform and text-shadow it did not want.

   Both dialogs now take focus when they open, hold Tab and Shift-Tab, close on Escape
   and on a backdrop click, and hand focus back to whatever opened them — all of it
   from one place, `lib/modalDialog.ts`, used by `EventEditor.svelte`'s info modal and
   `EditorView.svelte`'s preview lightbox. Focus, not the markup, was the actual
   defect.

   This entry previously described the problem as `EditorView.svelte` having a
   `role="dialog"` with no `tabindex` and no keyboard dismissal. Both halves were
   wrong, and the dialog it named was the healthier of the two. The preview lightbox
   *was* dismissable all along — its Escape listener is on `window`, not on the
   dialog element. Meanwhile `EventEditor.svelte`'s modal, which the entry did not
   mention, already had `tabindex="-1"` and its own Escape handler — but nothing ever
   moved focus into it, so the handler listened from an element that never had focus
   and **Escape did nothing at all** unless you first happened to click inside the
   dialog. An attribute audit found the dialog with the missing attribute; the broken
   one was the dialog whose attributes were all present and inert.

   So the fix was focus management in both, not `tabindex` in one. Closing either
   dialog also used to drop focus to `<body>`, restarting Tab at the top of the
   document. Escape is now handled by the dialog itself in both, which let the
   `window` listener in `EditorView.svelte` narrow to the share drawer — that drawer
   is an inline panel that never takes focus, so a window listener is the only thing
   that could hear the key for it. Two `svelte-ignore` comments went with the change:
   both dialogs' interaction handlers now live in the action, so there is no inline
   handler left to warn about.

   **An action, not a `<Modal>` component.** The two dialogs share every piece of this
   behaviour and none of their markup. The info modal is a title, prose and a close
   button; the preview lightbox is a toolbar around a cross-origin iframe, binds its
   backdrop's `clientWidth` to decide which size presets are reachable, and has
   responsive rules that reach into that backdrop — put the backdrop in a component
   and one responsive layout spans two files with scoped styles in between. A
   component covering both would exist to share a `<div>`. Worth revisiting if a third
   dialog shaped like the info modal appears: at that point two of three share markup,
   and such a component would use this action internally.

   **The iframe is the interesting case.** The preview lightbox holds the player in a
   cross-origin iframe. Once focus is inside it the parent document sees only the
   iframe as `activeElement`; key presses within it are not observable, so Tabbing off
   the end of the player's own controls hands focus back to the parent *after* the
   iframe, skipping a keydown-based trap entirely. The iframe is deliberately left
   tabbable — a preview you cannot reach by keyboard is not much of a preview — and
   the leak is caught by a `focusin` listener on the document that pulls focus back
   when it lands outside the dialog. That handover does fire in the parent, which is
   what makes it recoverable. It also covers programmatic focus moves from elsewhere
   in the app, which a keydown handler equally cannot see.

   One known limit, unchanged by this work: with focus inside that iframe, Escape does
   not reach the parent, so it will not close the preview. Clicking outside the player
   first, or Tabbing out to the chrome, restores it.

   **The settings panel is a layer inside the lightbox, and behaves like one.** Escape
   works inwards: with the panel open it puts the panel away and leaves the preview up,
   and a second Escape then closes the preview. A click on the dark backdrop does not
   layer — it means the whole box, however much is open inside it — so `modalDialog`
   takes `onescape` separately from `onclose` rather than treating the two gestures as
   one.

   The toggle says `aria-expanded` rather than `aria-pressed`, since it governs
   whether the panel is there rather than holding a pressed state, and names the panel
   with `aria-controls` — only while open, because the panel is conditionally rendered
   and naming it when closed would point at an id that is not in the document.
   (`aria-pressed` stays correct on the rich-text editor's formatting buttons, which
   really are toggles.)

   Opening the panel moves focus to it, because tab order is document order and the
   panel renders last in the stage: without that, reaching it from the toggle meant
   Tabbing through the close button and the whole player first. Focus lands on the
   panel's container rather than its first control, since that control is its own close
   button and a stray Enter there would put away what you just opened — from the
   container, one Tab steps into the real controls. Closing the panel hands focus back
   to the toggle, which is not a nicety: the panel holds focus while open, and a focused
   element being unmounted drops focus to `<body>` without firing anything the dialog's
   focus guard can see, which would silently cost the dialog its Escape key again in
   exactly the way this entry started out describing.

**TimeNav has no roving tabindex.** Every marker (`tl-nav__label` button in
   `TimeNav.svelte`) is its own native tab stop, and its keydown handler only handles
   Enter/Space — no arrow/Home/End marker-to-marker navigation. For a timeline with many
   events this is a lot of individual Tab presses just to get through the nav. TL3 solved
   this with a single tab stop for the whole nav region plus arrow/Home/End hopping
   between markers (with focus-restoration if the active marker changes underneath) —
   **medium-large** complexity, deferred. — TL3 #763/#766

   **Settle the mark-vs-label question as part of this, not before it.** Today the
   label is the event's control where one renders, and the mark (`tl-nav__dot` /
   `tl-nav__span-bar`) takes that role only where no label stands in for it, so the
   nav offers exactly one tab stop per event either way. The marks are the better
   *control*: there is always exactly one per event, so "N events, N stops" becomes an
   invariant instead of something conditional on layout state. That conditional has
   already cost us one bug — marks whose labels the packer had placed stayed
   `aria-hidden` when the drawer had no rows at all, leaving 2-3 of 13 events
   reachable by neither keyboard nor screen reader (fixed in `da5d07b`) — and it also
   means focus is destroyed today if a relayout drops the label a reader is sitting
   on.

   The labels are the better *affordance*, and that is the whole cost: to a screen
   reader the two are already interchangeable, because `ariaLabel` is built once per
   event and the identical string is set on both. The asymmetry is for sighted
   keyboard users, who get a legible chip from a label and a 12px circle from a dot
   — and note there is no `:focus-visible` rule for either mark today, only for
   `tl-nav__label` and the drawer handle, so the compact case where marks already are
   the control has no visible focus treatment at all.

   What resolves both: the mark carries role, name and focus, and focusing it
   surfaces its label — the width expansion, halo and raised z-index the label
   already has on hover, driven by focus on the mark. The label becomes
   presentational.

   Deliberately not done as its own change. This work replaces per-event tab stops
   with one region stop plus arrow keys, at which point the primary unit has to be
   the thing that always exists — the mark — with the label highlighting as the
   reader arrows along. Landing mark-as-primary first would mean building mark focus
   styling twice, and the per-event stop count is a problem whichever element owns
   it.

**Tab order: slide content before prev/next arrows — done.** `SlidePlayer.svelte` now
   renders the prev/next/fullscreen buttons before the slide loop inside
   `.tl-player__stage`, so Tab reaches the nav controls before any in-slide links (arrows
   → fullscreen → in-slide links), matching TL3's ordering. (Absolute positioning means
   the DOM reorder doesn't affect visual layout.) `pauseSlide`'s lookup of the active
   slide element was switched from `stage.children[index]` to
   `stage.querySelectorAll(':scope > .tl-slide')[index]` since it can no longer assume
   slides are the stage's first children. — TL3 #763

---
## 2. Feature Roadmap (Post-Launch / Someday-Maybe)

Everything below is a candidate, not a commitment. Rated by **Value** (impact if built) and
**Complexity** (rough effort), with a priority call. TL3 issue numbers are for reference/test
cases, not requirements to match TL3 behavior exactly.

### Group & marker theming — High value, Medium-Large complexity

The most-requested TL3 gap (#847, #489, #798). Rough UX direction: an auto-suggest/create
text box for assigning an event to a group (encourages consistent naming across slides),
paired with a GitHub-tag-style color picker. Marker colors would not be independently
settable — instead, a slide's background color could optionally propagate to its marker via
a toggle next to the background-color control ("marker too?"). Background *images*
propagating to markers is out of scope (too visually noisy at marker scale).

### Custom typography — Medium value, Medium complexity

No per-timeline font override exists today (`TLSettings` has no font field; the player
always uses its built-in font stack). Would need a schema field, a font-picker/loader in
`SettingsPanel.svelte`, and CSS custom-property plumbing through the player. Also affects
the poster/`og:image` generator (`packages/authoring/src/lib/poster.ts`) — it currently
hardcodes `system-ui` for headline/description text via Canvas 2D, so once custom fonts
exist, the poster would need to load/apply the same font (e.g. via `FontFace`) to stay in
sync with the real timeline's look, or explicitly fall back with that tradeoff understood.

### Eras — High value, Large complexity, **needs a design pass first**

Not yet implemented at all. TL3 issues (#292 unbounded/ongoing eras, #229 overlap, #321
background colors, #838 same start/end date) define roughly what a full implementation
needs. **Do not start building against the TL3 schema** — sketch UX prototypes first, since
this is a big enough feature that the shape is worth getting right before investing.
Unbounded/ongoing eras (#292) may turn out to be covered by event durations + an end title
slide instead of a distinct era feature — worth resolving together.

### Ending title slide — Medium-High value, Small-Medium complexity

Mirror of the existing opening title slide, shown at the end (#204). Pairs naturally with a
`start_at_end` option (#547) for "open at the last event."

### RTL layout support — Medium value, Medium complexity

i18n infrastructure (flat JSON + `Intl.DateTimeFormat`) should already support this; layout
(slide direction, TimeNav direction) is untested and likely needs CSS logical-property
work. — TL3 #828

### Deep link to event by ID — Medium value, Small-Medium complexity

`start_at_slide_id`-equivalent + URL-based navigation (#473, #676). Natural companion to
hash-bookmark cleanup (#382, #341).

### Auto-advance / play mode — Medium value, Medium complexity

Kiosk/presentation use case (#882, #280). Needs a pause-on-interaction story and to respect
`prefers-reduced-motion`.

### Uncertainty / fuzzy dates — Medium value (scholarly/journalism niche), Small-Medium complexity

Substantially covered now that the `display_date` field is authorable (see Decided/Resolved
below) rather than needing a distinct "uncertainty marker" UI. — TL3 #499

### Quick search / locate headline from TimeNav — Medium value, Medium complexity

Useful once timelines get long. — TL3 #631

### Swipe left/right to navigate on touch devices — Medium-High value, Small-Medium complexity

`SlidePlayer.svelte`'s stage has no touch/swipe handling today — only the prev/next
arrow buttons and keyboard arrows advance slides. On a phone or tablet, swiping the
slide itself feels like the natural gesture and is what TL3 lacked too. `TimeNav.svelte`
already uses pointer events for its own drag-to-scrub interaction, so there's a working
pattern in the codebase to follow; the main design question is distinguishing a
horizontal swipe from vertical scroll and from taps on in-slide links/media (e.g. a
horizontal-distance/velocity threshold before treating it as navigation, rather than
capturing every touch).

### Navigator marks had no hover feedback — done.

Both marks now take `--tl-color-nav-marker-hover` under the pointer, the same
token the label already used and the only one each skin calibrates against its
own nav background. A dot and a span bar are the same thing to a reader — this
event, on the timeline — so they answer the pointer the same way; the bar says
it across both borders and the rule between them, since that is what draws it.
An active mark holds its own colour on hover, as the active label does, rather
than trading the one signal saying which slide you are on for something the
cursor already says.

This entry previously described it as a span-bar question, on the grounds that
the dots already had a colour change. They did not: `.tl-nav__dot` had no
`:hover` rule at all, only a `background` transition on its `::before` that
nothing ever triggered. So the bar was not the odd one out — the label was the
only mark in the navigator that responded to hover, and the fix was to give
both marks the feedback rather than to pick an opacity for one of them.

`--tl-nav-span-bar-hover-opacity` still applies and still defaults to the
resting `0.75`, so a theme that was already lifting the bar's opacity keeps
doing so; it is simply no longer the only thing hover has to work with.

### Media: fixes and small adds — Low-Medium complexity each, do opportunistically

- **YouTube start/end params — done.** `resolveMedia` parses `t`/`start`/`end`, including
  `1h2m3s`-style durations; regression tests added in `resolver.test.ts` (#779).
- **Wikipedia image caption/credit prefill — done.** Confirming a `wikipediaimage` URL in
  `EventEditor.svelte` (`confirmUrl` → `maybePrefillFromWikipedia`) now fetches
  `extmetadata` from the Commons/Wikipedia `imageinfo` API and, only for fields still
  blank, fills `caption` from `ImageDescription` and `credit` with a link back to the
  file's description page, labeled `"<Artist> via Wikimedia Commons"` (or `"...via
  Wikipedia"`) when an `Artist` field is present, else just the site name. The `Artist`
  field reliably reflects the actual creator rather than whoever technically uploaded the
  file — confirmed against a file whose `Permission` metadata shows it was uploaded by a
  bot/reviewer distinct from the Flickr photographer named in `Artist`. New helper:
  `packages/authoring/src/lib/wikipediaPrefill.ts`. Also fixed two related timing bugs:
  (1) `confirmUrl()` used to set `editingMedia = false` synchronously, closing the whole
  media editor (and unmounting the caption/credit rich-text fields) before the prefill
  fetch resolved, so filled-in values only became visible after reopening the editor —
  `confirmUrl` no longer closes the panel itself; a new `confirmUrlAndClose` (Done button,
  blur-outside-the-editor) does the confirm-then-close. (2) The prefill lookup was gated
  behind an explicit confirm (Enter/Tab/Done) while `MediaPreview.svelte`'s own image-src
  fetch (`wikiImagePromise`) fires reactively off `resolved.kind` the instant the URL
  parses as recognizable — two redundant calls to nearly the same MediaWiki API on two
  different triggers, which is why the image would appear well before the caption/credit
  did. `maybePrefillMediaText` is now driven by the same reactive signal (an `$effect` on
  `mediaInput.resolved.kind`) instead of being called from `confirmUrl`, so caption/credit
  land alongside the image preview with no confirm step needed at all. Verified live: typing
  the URL and never pressing Enter/Tab/Done still fills Caption and Credit in place a
  couple seconds after the preview image appears, and re-editing the same URL after
  hand-editing the caption left the author's text alone.
- **Flickr caption/credit prefill — done.** Confirming a `flickr` URL now also runs through
  `maybePrefillMediaText`, calling the new `fetchFlickrPrefill`
  (`packages/authoring/src/lib/flickrPrefill.ts`, JSONP-based like the player's own
  `fetchFlickrOEmbed` since Flickr's oEmbed endpoint has no CORS headers). Fills blank
  `caption` from the oEmbed `title` and blank `credit` with a link labeled by
  `author_name` back to the photo page. Verified live (#827).
- **`width`/`height` on `<img>` tags — done where the source API provides real dimensions**
  (#673). Wikipedia article thumbnails, Wikipedia file lookups (needed `iiprop=size` added
  to the MediaWiki query — `url` alone doesn't return dimensions), Flickr oEmbed, and
  Bluesky embedded images/video now set explicit `width`/`height` from the fetched
  metadata. The plain author-supplied `image` kind (a bare URL with no metadata fetch)
  still has no intrinsic size available and is unchanged — closing that gap needs either a
  schema field populated at authoring/upload time or a dimension-probing fetch, which is
  more than "small complexity."
- OpenStreetMap embed — not in TL3 either; reasonable new addition, low complexity.
- Google Slides / Facebook public video / MathJax — niche, evaluate on request. MathJax
  may already be reachable through the existing HTML/blockquote embed path.
- **Media editor: split into independently toggleable sub-fields — Medium complexity,
  not started.** `EventEditor.svelte`'s media editing is currently one monolithic
  `editingMedia` flag covering URL, caption, credit, and alt text together — closing any
  one of them (e.g. confirming the URL) collapses the whole panel, unlike headline/body
  which already have independent `editingHeadline`/`editingBody` open state. Worth
  revisiting once there's a second reason to touch this (e.g. another prefill source, or
  a caption-only quick-edit request) so the caption/credit fields can stay open and
  editable independent of the URL field's own confirm/close cycle, and vice versa.
- **Decided against: autoplay on YouTube/video links** (#625) — user-hostile, not adding.
- **`at://` URIs directly in `media.url`** (Currents/Grain/Plyr and similar ATProto apps) —
  maybe. `resolveMedia` has no `at://` branch today; the in-progress repo browser
  (`collections.ts`) resolves records client-side rather than storing at-URIs in JSON.
  Would need an `at://` parsing branch plus sharing the per-app record-shape knowledge with
  `core`/`player`, following the existing async-resolve pattern (Bluesky/Twitter/TikTok).
  Notably the only path for Grain/Plyr, which have no confirmed web-view URL to fall back on.

### Opening a published timeline twice made two drafts — fixed, with one case left open

Opening a record from "In your account" used to mint a fresh local draft every time:
`createDraft` calls `newDocId()` unconditionally, and `noteDraft` dedupes by draft id,
which a new draft never collides on. Open the same timeline twice and the home screen
listed it twice, both "edited just now", both carrying the same `atUri` — two claims on
one published record, where whichever was opened last silently won the next publish.

Not a Yjs merge problem, though the comments nearby explain why it looked like one. A
fresh `Y.Doc` per draft is deliberate: a document carries its whole history, so pouring
a second timeline into an existing one persists both, and `openDraft` attaches to an
empty doc because attaching merges. That is a reason not to reuse a *document*, not a
reason to skip looking for an existing *draft*. `handleOpenRecord` now checks
`listDrafts()` for one carrying this `atUri` and reopens it.

**Left open: the stale case.** If the record was published from another browser since,
the local draft is older than what is in the account, and reopening it shows the older
content without saying so. `listTimelines` already returns each record's `createdAt`
and every draft has an `editedAt`, so the comparison is available — what is missing is
the decision about what to do with it: warn, offer both, or let the newer one win.
Related, and removed by the same fix: there is now no way to pull a fresh copy from
the published version and abandon local edits, which the duplicate drafts used to
provide by accident.

### Authoring vocabulary pass — Needs focused attention, Small complexity

"PDS" appears in eight user-facing strings: a `PDS · image` badge, "Stored on your
personal data server (PDS).", "Publish to your PDS", "Reload from your PDS", an
upload/URL help line, and two glossary entries in the media-types modal. The audience
is people who reached for Google Sheets, so the term is wrong in a label — but the two
glossary entries deliberately *define* it, so this is not a find-and-replace.

Tangled with it: the save/publish split. A PDS write is "publish", never "save", and
the home screen mostly holds that line ("Nothing published yet", "never published",
and the lists now read "In this browser" / "In your account") — but the persistence
warning still says "Save to your account to keep it", which crosses it. Worth settling
the whole vocabulary in one pass rather than per-string.

### Renaming a timeline may read as "Save as" — Low priority, unconfirmed

Changing the display name in the editor subnav edits the title of the timeline you are
already in. Someone used to desktop software could take it for "Save as" and expect a
second, separately-named copy, then find their original gone — and the draft index
lists drafts by title, so the old name genuinely disappears from the home screen.

Unlikely enough to leave alone for now, and worth confirming against a real user before
designing for it. If it turns out to bite, the cheap answer is wording near the field
rather than a new concept; a real duplicate command is a different feature.

### Component testing — Infrastructure, Medium complexity

There are no Svelte component tests. The suite covers `lib/` thoroughly — documents,
history, persistence, media resolution, the focus trap's own logic — and stops at the
component boundary, so everything about how a component actually behaves when mounted
is verified by hand or not at all.

What that costs is specific rather than theoretical. The dialog work landed with its
tabbable-set and wrap logic tested and its *wiring* untested: whether opening the
settings panel from the subnav resolves focus in the right order, whether an error
banner appears when an open fails, whether a row re-enables after a failure. Those are
the parts that broke, and the parts no test watches. The blob-ref regression is the
same shape — a crash on a path with no coverage between the store and the screen.

`@testing-library/svelte` with the existing happy-dom setup is the obvious starting
point. The first one is the expensive one: mounting a component means confronting the
auth module, `import.meta.env`, IndexedDB persistence and the OAuth client, so part of
this work is deciding what gets faked and where that seam lives. Worth doing on a
component with few dependencies first — `SettingsPanel` or `DatePicker` — rather than
starting with `EditorView`.

### Alternative calendars & generalized timespans — Low priority, Large complexity, speculative

Two distinct asks with no TL3 issue numbers, from community requests: (a) non-Gregorian
calendar support (Jewish, Islamic, etc.), (b) timespans not anchored to specific dates
("processes" rather than events). Both need real research before sizing — flagging so
they're not forgotten, not because they're near-term.

### Config knobs (disable minor ticks, remove TimeNav, TimeNav-only mode, fill-frame title slide, logarithmic/non-linear scale) — Low priority individually, Small complexity each

Bucket of TL3 config options (#674, #542, #448, #300, #662, #394) with no strong signal yet.
Revisit if a specific request materializes rather than building speculatively.

### Undated / interstitial slides — Low priority, Medium complexity, deferred

Slides with no date, placeable anywhere (not just as the title slide). Problem: TimeNav is a
time axis, so an undated slide has no coordinate — would need to float, pin to an adjacent
event, or hide from the scrubber. Needs its own design pass; not worth building without
demonstrated demand.

### IIFE / `<script src>` standalone bundle — Low priority, Small complexity, deferred

TL3-legacy consumption pattern. Modern consumers should use npm or the iframe embed. If
demand shows up, it's a second ~20-line Vite config that doesn't touch the npm packages or
embed page.
