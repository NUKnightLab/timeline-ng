# Changelog

All notable changes to `@knight-lab/timeline-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **`fontPairing` prop**, applying one of the TimelineJS 3 font pairings from
  `@knight-lab/timeline-ng-core`. The pairing's tokens ship as
  `styles/pairings.css`, a generated `[data-tl-font]` block per pairing, so
  normal cascade rules apply. The player supplies tokens only and never loads
  font files — whoever mounts it serves the faces named in the pairing's
  `webfonts`, and an unserved face falls back through the pairing's own stack.
  An unrecognised id resolves to the default pairing rather than throwing,
  since a saved record can outlive the pairing it names.

- **`navChrome` prop** (`'standard' | 'minimal'`). Minimal removes the zoom
  controls, date axis and minimap and reclaims the space they occupied — 44px
  of gutter and 18px of axis band, nav height 106 to 88. Fading chrome with
  token values leaves its layout behind, which is why this is a prop.

- **`highContrast` prop**, raising text and marks to WCAG AAA: worst measured
  case 15.13:1 in light and 15.91:1 in dark. It spans slide and navigator
  alike and is applied last, so where it disagrees with a pairing or a nav
  treatment about a colour it wins — an accessibility mode a styling choice
  could override would not be one.

  The three axes above are orthogonal to each other and to `theme`, and each
  is a set of token values selected by its own data attribute on the player
  root. The cascade runs base defaults < pairing < navChrome < highContrast <
  embedder.

- **A much wider token surface**, so those layers need no component overrides.
  New: the nav's top border, label chip fill/ring/radius/padding, zoom gutter
  fill and border, axis strip background, border and tick colour, leader,
  track and minimap opacities, group band border and tint, marker and button
  target sizes, `--tl-nav-dot-active-scale`, `--tl-date-transform`,
  `--tl-headline-transform`, `--tl-headline-color`, `--tl-body-color` and the
  `--tl-slide-text-only-*` trio.
- `--tl-focus-ring-width`, `--tl-focus-ring-offset` and `--tl-focus-ring-color`,
  replacing five hardcoded `2px solid var(--tl-color-accent)` declarations
  across three components. A focus ring's weight and offset were previously
  unreachable.
- `--tl-nav-mark-active`, separating the active *mark* colour (dot, span bar,
  leader stroke, minimap thumb) from `--tl-color-nav-marker-active`, which now
  sets only the active label's text. One token drove both, which made a
  light-on-dark active label impossible — inverting the label also turned the
  active dot white on a white nav and erased it. Defaults to
  `--tl-color-nav-marker-active`, so existing overrides are unaffected.

### Changed

- **Slide content is vertically centred** in the stage, matching TimelineJS 3,
  rather than pinned to the top; media and text columns centre against each
  other too. Centring uses auto block margins rather than
  `justify-content: center`, so a slide taller than the stage still scrolls
  from its true top instead of clipping it out of reach. Set
  `--tl-slide-valign: 0` and `--tl-slide-media-align: start` for the previous
  behaviour.
- **The slide date is no longer a bold, uppercase, letter-spaced eyebrow.** It
  was among the loudest things on a slide when it should be among the
  quietest; it is now plain sentence case at reading size (0.9375rem/400).
  Reachable through `--tl-date-size`, `--tl-date-weight`,
  `--tl-date-tracking` and `--tl-date-transform`.
- **Body copy is a step lighter than the headline** rather than sharing its
  colour — `#111111`/`#3d3d3d` light and `#f8f8f8`/`#d2d2d2` dark, measuring
  10.86:1 and 11.51:1. Slides with a dark or image background flip both.
- **The navigator is quieter.** A lighter band (`#f2f2f2`, was `#e0e0e0`) with
  a hairline top rule, labels with no chip ring, a zoom column with no
  divider, group bands with no alternating tint, and a lighter marker
  (`#6e6e6e`, was `#555555`) — the lightest that still clears AA against the
  band, at 4.55:1. The date axis keeps sitting directly on the band, with no
  strip of its own.
- **Default typography** is now the `georgia-helvetica` pairing rather than
  bare `system-ui`: Georgia headlines, Helvetica Neue body at 17px. It is the
  one pairing built from system fonts, so it needs no downloads and covers
  every writing system.
- An active nav label keeps its colour on hover and focus instead of taking
  the generic hover colour, which is calibrated against the nav background
  rather than whatever pill the label sits on. The halo, width expansion and
  raised z-index still supply the feedback; `--tl-nav-label-active-hover` sets
  a shade if one is wanted.
- `--tl-nav-marker-size` now means the marker's diameter (12px). It previously
  sized a content box that had no effect on what was drawn.

### Fixed

- Wheel-zoom in the navigator anchored up to 44px left of the pointer. It
  computed the cursor's position against the constant gutter width rather than
  the gutter actually in use, which is narrower when the player is compact and
  zero when `navChrome: 'minimal'` removes the zoom controls — so the error was
  worst in the mode where the wheel is the only way to zoom, and it compounded
  with every step. The point under the pointer now stays under the pointer.

- **Navigator labels piled on top of each other** on any timeline whose events
  cluster, which is most real ones. Three causes:
  - The drawer opened to one row regardless of the data. The row count the
    dataset needs was already computed, but only used to cap the drag, never
    to set the initial height. It now seeds it.
  - A label with no free slot was clamped to the right edge, so every label
    that ran out of room landed on the same spot. Such a label is now dropped;
    its marker still shows the date and still navigates, and zooming in
    restores the label once there is room. A dropped label hands its
    accessible role to its marker, which is otherwise hidden from assistive
    tech as a duplicate — without that, events would become unreachable by
    keyboard on exactly the crowded timelines where labels get dropped.
  - Zoom centred on the middle of the viewport, so a timeline bunched at one
    end zoomed into empty space. It now anchors on the active event whenever
    that event is on screen.

  On a clustered 11-event timeline: 1 row with 45 overlapping label pairs, 29
  of them at identical positions, becomes 3 rows with none.
- **The active event could have no label at all**, since labels are placed
  left to right and the earliest events took the available slots. A navigator
  that cannot show where you are has failed at its main job. The active event
  now takes the slot nearest its own position and drops that slot's previous
  occupant instead.
- **Axis labels ran off both ends** of the navigator. The edge treatment that
  anchors a label's near side to its tick existed but was only ever applied to
  two synthetic ticks; it now applies to any tick whose label would overflow.
- **The axis line stopped short of the first and last events**, leaving a
  visible gap between the end dot and the line. It was inset 2% at each end
  while the marks span the full width.
- **Leader lines failed WCAG AA** at 2.11:1 in light and 2.91:1 in dark,
  against the 3:1 required for non-text that carries meaning. Default opacity
  is now 0.7, the lightest that clears both.
- **Target sizes below WCAG 2.2 SC 2.5.8.** Zoom buttons were 28x20 and are
  now 24x24; marker hit areas were roughly 12x12 and are now 12x24. Markers
  are deliberately not widened to 24: they are placed by date and can sit a
  few pixels apart, so square targets would occlude each other and strand the
  earlier of two close events — worse for the users the criterion protects.
  `--tl-nav-dot-target-x` widens them for timelines sparse enough to afford it.

## [0.3.0] - 2026-07-28

### Added

- `SlidePlayer` accepts an `autofocus` prop, so a consumer can focus the
  player root on mount (used by the embed app when it's the top-level
  document — i.e. a direct share link — but not when framed in an iframe,
  where focus should stay with the host page until the visitor interacts).
- Media images now carry explicit `width`/`height` attributes when the
  source API provides them (Wikipedia article thumbnails and file lookups,
  Flickr oEmbed, Bluesky embedded images/video), reducing layout shift
  while they load.

### Changed

- Media credit now displays above the caption, right-aligned under the
  media and bound tightly to it, in a slightly smaller size than the
  caption text.

### Fixed

- Switching `language` (or otherwise swapping in a differently-sized
  `timeline`) no longer resets `SlidePlayer` back to `initialIndex` —
  it stays on the current slide and only clamps into bounds if the new
  timeline has fewer slides. The reset-to-`initialIndex` behavior is
  preserved for when `initialIndex` itself actually changes (e.g. the
  authoring app's live preview retargeting to a different event).
- A rich-text `<p>` inside the media credit no longer picks up the
  browser's default 1em block margins — the override selector needed
  `:global()` since the `<p>` comes from `{@html}` and Svelte can't scope
  to markup it didn't render itself.

- Inactive slides are now `inert`, so keyboard/screen-reader focus can no
  longer land on off-screen slide content (e.g. a media credit link) while
  a different slide is displayed.
- A slide is only a tab stop — and only claims arrow keys for scrolling —
  when its content actually overflows. Previously every active slide was
  focusable regardless, so arrow keys could silently do nothing once focus
  landed there via Tab or a click on non-interactive slide text.
- Stepping to the next/previous slide (keyboard arrows or the prev/next
  buttons) now always refocuses the player root, instead of only when a
  boundary button was about to become disabled — so focus can't be left
  stranded on a control or link that doesn't apply to the new slide.
- Tab order within the player now reaches the prev/next/fullscreen controls
  before any in-slide content (links, etc.), instead of after — matching
  TL3's ordering and cutting the number of Tab presses needed to get from a
  slide's content to the navigation controls.

## [0.2.1] - 2026-07-22

### Added

- `loadTimeline` (and thus the `@timeline-ng/embed` app's `?src=` param)
  now accepts a Google Sheets "publish to the web" link directly, in
  addition to hosted JSON — no account or PDS save required to embed a
  Sheets-backed timeline.

### Fixed

- `SlideContent`'s scrollable area now reserves space for `TimeNav`'s
  current height, so content at the bottom of a long slide is never
  hidden behind the nav, no matter how tall it renders.
- An event's `display_date` (set on `start_date`) now overrides the
  entire displayed date range, instead of only replacing the start
  portion when an `end_date` is also present.

## [0.2.0] - 2026-07-20

### Added

- Full-screen toggle on `SlidePlayer`, with cross-browser (standard +
  `webkit`-prefixed) support. Hidden when the Fullscreen API is unsupported
  or blocked by the embedding iframe's `allow` policy.

### Fixed

- `TimeNav` labels no longer render raw HTML markup from an event's
  `headline` (e.g. a stray `<p>` tag); the label and its accessible name
  are now derived from stripped plain text ([#5](https://github.com/NUKnightLab/timeline-ng/issues/5)).
- `TimeNav` labels that can't be shifted apart within the layout's shift
  budget are now packed into the least-crowded row with the same minimum
  gap as normally-placed labels, instead of rendering directly on top of
  a neighbor; labels also get a subtle outline so closely-packed labels
  stay visually distinct ([#2](https://github.com/NUKnightLab/timeline-ng/issues/2)).
- Wikipedia image URLs pointing at a `File:` page directly (not just the
  `#/media/File:` lightbox form) now resolve as images instead of being
  treated as article embeds; and fair-use/non-free images that only exist
  on the local language wiki (not on Wikimedia Commons) now load correctly
  ([#4](https://github.com/NUKnightLab/timeline-ng/issues/4)).

## [0.1.0] - 2026-07-04

Initial public release. Earlier history predates this changelog; see
`git log` for detail.

[Unreleased]: https://github.com/NUKnightLab/timeline-ng/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NUKnightLab/timeline-ng/releases/tag/v0.1.0
