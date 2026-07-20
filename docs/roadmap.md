# [](https://)****timeline-ng Roadmap

Based partly on an AI review of 200 open TimelineJS3 GitHub issues (harvested 2026-06-26) plus launch-planning notes.
Where TL3 issues are cited, the number links back to the original for detail.

---

## 1. Accessibility

**No closed-caption support for video.** `TLMedia` has no `captions`/`vtt` field, and
   the native `<video>` has no `<track>`; hosted embeds (YouTube etc.) rely on the
   platform's own CC UI. Needs a schema field + authoring UI + passthrough — **medium**
   complexity, candidate for a fast-follow rather than blocking launch. — TL3 #624

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

May be substantially covered by exposing `display_date` (see Authoring gap below) rather
than a distinct "uncertainty marker" UI. — TL3 #499

### Quick search / locate headline from TimeNav — Medium value, Medium complexity

Useful once timelines get long. — TL3 #631

### Media: fixes and small adds — Low-Medium complexity each, do opportunistically

- Verify YouTube start/end params actually work end-to-end (#779) — should already work,
  worth a regression test.
- Flickr: prefill caption/credit (and link back to the source) the way TL3 forced a caption
  to display, but leave it editable (#827).
- Add explicit `width`/`height` to `<img>` tags to reduce layout shift (#673).
- OpenStreetMap embed — not in TL3 either; reasonable new addition, low complexity.
- Google Slides / Facebook public video / MathJax — niche, evaluate on request. MathJax
  may already be reachable through the existing HTML/blockquote embed path.
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

### Authoring: `display_date` field — Medium value, Small-Medium complexity

`TLDateInput.display_date` (override rendered date text, e.g. "circa 1900") already exists
in the core type and docs, but `DateFields.svelte` has no field for it — only reachable by
hand-editing JSON/CSV. Flagged as a future authoring pass; also unlocks part of the
uncertainty-markers use case above.

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

- **No published Lexicon** for `com.knightlab.timeline` — interop outside the tool isn't
  expected for v1.
- **npm org:** `@knight-lab`, packages are `@knight-lab/timeline-ng-core` and
  `@knight-lab/timeline-ng`.
- **Embed URL:** unversioned at `https://timeline.knightlab.com/ng/embed/`; add `/v1/` only
  if a breaking change actually forces it.
- **Vite base path:** left as relative `'./'`.
- **Autoplay on video/YouTube links:** rejected as user-hostile.
- **Legacy-browser issues (IE11, old Edge):** not applicable, ignored.
