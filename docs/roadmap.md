# [](https://)****timeline-ng Roadmap

Based partly on an AI review of 200 open TimelineJS3 GitHub issues (harvested 2026-06-26) plus launch-planning notes.
Where TL3 issues are cited, the number links back to the original for detail.

---

## 1. Accessibility

**No closed-caption support for video.** `TLMedia` has no `captions`/`vtt` field, and
   the native `<video>` has no `<track>`; hosted embeds (YouTube etc.) rely on the
   platform's own CC UI. Needs a schema field + authoring UI + passthrough — **medium**
   complexity, candidate for a fast-follow rather than blocking launch. — TL3 #624

**TimeNav has no roving tabindex.** Every marker (`tl-nav__label` button in
   `TimeNav.svelte`) is its own native tab stop, and its keydown handler only handles
   Enter/Space — no arrow/Home/End marker-to-marker navigation. For a timeline with many
   events this is a lot of individual Tab presses just to get through the nav. TL3 solved
   this with a single tab stop for the whole nav region plus arrow/Home/End hopping
   between markers (with focus-restoration if the active marker changes underneath) —
   **medium-large** complexity, deferred. — TL3 #763/#766

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

---

## 3. Decided / Resolved (reference only)

- **`display_date` authoring field — shipped.** The date-editing panel in `EventEditor.svelte`
  now has a "Display date" text input that sets `TLDateInput.display_date` on the start date,
  overriding the rendered date text (e.g. "around 1500", "the Roaring Twenties"). A real start
  year is still required — Timeline still needs it to place the slide. Also fixed a latent bug
  in `SlideContent.svelte` where an event with both `display_date` and an `end_date` would show
  the override concatenated with a formatted end date instead of just the override text.
- **No published Lexicon** for `com.knightlab.timeline` — interop outside the tool isn't
  expected for v1.
- **npm org:** `@knight-lab`, packages are `@knight-lab/timeline-ng-core` and
  `@knight-lab/timeline-ng`.
- **Embed URL:** unversioned at `https://timeline.knightlab.com/ng/embed/`; add `/v1/` only
  if a breaking change actually forces it.
- **Vite base path:** left as relative `'./'`.
- **Autoplay on video/YouTube links:** rejected as user-hostile.
- **Legacy-browser issues (IE11, old Edge):** not applicable, ignored.
