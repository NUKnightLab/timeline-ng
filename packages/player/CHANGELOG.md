# Changelog

All notable changes to `@knight-lab/timeline-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `styles/pairings.css`, generated from `FONT_PAIRINGS` — each pairing's tokens
  as a `[data-tl-font]` block. Imported before the nav and contrast layers so
  the cascade reads base defaults < pairing < navChrome < highContrast <
  embedder.

- A `fontPairing` prop on `SlidePlayer`, applying a pairing's typography tokens
  as inline custom properties. The player supplies tokens only and never loads
  font files — whoever mounts it serves the faces. An unrecognised id is
  ignored rather than throwing, since a saved record can outlive a pairing.

- `--tl-headline-transform`, so a font pairing can set its headline in caps —
  five of the TimelineJS 3 pairings do. Defaults to `none`.

- **`navChrome` and `highContrast` props**, replacing the `skin` prop. Three
  independent axes now, each expressed as token values and each selected by its
  own data attribute on the player root:
  - `navChrome: 'quiet'` keeps every navigator control but draws it with less
    ink — no chip rings, no band tints, no gutter divider. The restraint comes
    from removing marks rather than lightening them, because lightening is what
    made TimelineJS 3's navigator inaccessible: its date measures 2.10:1 on
    white and its axis ticks 1.84:1.
  - `navChrome: 'minimal'` *removes* the zoom controls, date axis and minimap
    and reclaims their space — 44px of gutter, 18px of axis band, nav height
    106 to 88. This is the part no set of token values could do: fading chrome
    with opacity leaves its layout behind.
  - `highContrast` raises everything to WCAG AAA, worst case 15.13:1 light and
    15.91:1 dark. It spans slide and navigator alike and applies last, so where
    it disagrees with a nav treatment or a pairing about a colour it wins — an
    accessibility mode a styling choice could override would not be one.

  A skin had bundled these three unrelated axes under one name, which is why
  none of them could be described to a user. Both new settings are exposed in
  the authoring tool, and every combination is verified in the contrast-lab app, which
  measures rendered colours rather than stylesheet values.
- `--tl-nav-mark-active`, splitting the active *mark* colour (dot, span bar,
  leader stroke, minimap thumb) out of `--tl-color-nav-marker-active`, which
  now sets only the active label's text colour. One token previously drove
  both, which made a light-on-dark active label impossible: inverting the
  label also turned the active dot white on a white nav and erased it.
  Defaults to `--tl-color-nav-marker-active`, so existing overrides are
  unaffected.
- `--tl-focus-ring-width`, `--tl-focus-ring-offset` and `--tl-focus-ring-color`,
  replacing five hardcoded `2px solid var(--tl-color-accent)` declarations
  across three components. These were previously reachable only by colour, not
  by weight.
- `--tl-nav-dot-active-scale` (was a hardcoded `scale(1.4)`) and
  `--tl-nav-btn-size`, `--tl-nav-dot-target-x`, `--tl-nav-dot-target-y`.
- A set of `--tl-nav-*` and slide typography tokens covering values that were
  previously hardcoded — the nav's top border, label chip fill/ring/radius, the
  zoom gutter's fill and border, axis strip background and tick colour, leader,
  track and minimap opacities, group band border and tint, plus
  `--tl-date-transform`, `--tl-headline-color`, `--tl-body-color` and the
  `--tl-slide-text-only-*` trio. Every default matches the previous hardcoded
  value, so nothing changes unless a layer or embedder sets them. These exist
  so each layer can be expressed purely as token values, with no component
  overrides.

### Changed

- An unset (or unrecognised) `fontPairing` now resolves to `DEFAULT_PAIRING`
  rather than falling through to the raw token defaults in `base.css`. Those
  two paths produced near-identical output by coincidence rather than design.
  One consequence is visible: with no pairing named, headlines are now Georgia
  and body copy Helvetica Neue at 17px, where before both were `system-ui` at
  16px.
- No layer sets `--tl-font-heading` or `--tl-font-body`. Which faces render is
  the author's choice, expressed through the font pairing; a layer that pinned
  the family made picking a typeface do nothing while that layer was on. Layers
  adjust size, weight and colour — never the family.

- The slide date no longer renders as a bold, uppercase, letter-spaced eyebrow.
  It was one of the loudest elements on a slide when it should be among the
  quietest; it is now plain sentence case at reading size (0.9375rem/400),
  following TimelineJS 3. The previous treatment is still reachable through
  `--tl-date-size`, `--tl-date-weight`, `--tl-date-tracking` and
  `--tl-date-transform`.
- Body copy is now a step lighter than the headline rather than sharing its
  colour, via new `--tl-headline-color` and `--tl-body-color` defaults
  (`#111111`/`#3d3d3d` light, `#f8f8f8`/`#d2d2d2` dark; 10.86:1 and 11.51:1
  for body). Slides with a dark or image background flip both tokens
  alongside `--tl-color-text`.
- Slide content is now vertically centred in the stage, matching TimelineJS 3,
  rather than pinned to the top; media and text columns centre against each
  other too. Centring uses auto block margins rather than
  `justify-content: center`, so a slide taller than the stage still scrolls
  from its true top instead of clipping it out of reach. Set
  `--tl-slide-valign: 0` for the previous top alignment, and
  `--tl-slide-media-align: start` for the previous column alignment.

### Fixed

- Hovering an active TimeNav label dropped it to unreadable contrast under the
  high-contrast layer — dark blue on near-black, 1.73:1 in light and 2.16:1 in
  dark, against resting states of 17.40:1 and 21.00:1. `.tl-nav__label:hover`
  is (0,2,0) and outranks `.tl-nav__label--active` at (0,1,0), so hover swapped
  in `--tl-color-nav-marker-hover` — a colour calibrated against the nav
  background — while the label kept its own inverted pill. Active labels now
  hold their colour through hover and focus; the halo, width expansion and
  raised z-index still provide the feedback. `--tl-nav-label-active-hover` sets
  a shade matched to whatever pill a layer chose.

- Axis labels ran off the ends of the TimeNav. Each tick is centred on its
  date, so a label near either edge overflowed the strip and was clipped. An
  edge treatment that anchors the label's near side to the tick already
  existed, but was only ever applied to the two synthetic ticks used when no
  real ones fit — every generated tick stayed centred. It now applies to any
  tick whose label would overflow, at either end, with the tick mark staying
  exactly on its date and the text running inward.

- The TimeNav axis line stopped short of the first and last events, leaving a
  visible gap between the end dot and the line. The line was inset 2% at each
  end while the marks are positioned across the full 0-100% of the same box,
  so the extreme dots sat outside it. The inset is a leftover from an earlier
  layout where it was `margin: 0 2%` on the track itself and moved the marks
  along with the line; the rewrite kept it on the line alone. The line now
  spans the full track.

- TimeNav marker dots rendered as vertical ellipses. The dot's visible size had
  always come from its padding box, not — as the code claimed — from a tiny
  content box clipped by `background-clip: content-box`: the `background`
  shorthand declared after it reset `background-clip` back to `border-box`.
  With uniform padding the result was a circle by accident, so giving the dot a
  taller hit target for SC 2.5.8 stretched the mark with it. The visible dot is
  now drawn by a `::before` at a fixed size, independent of the target, and the
  active state scales that mark rather than the target — growing a target on
  selection would have let it steal clicks from its neighbours.
- `--tl-nav-marker-size` now means what its name implies: the dot's diameter,
  defaulting to 12px. It previously set a content box whose size had no effect
  on the rendered dot.

- TimeNav zoom/navigation buttons were 28x20px, under WCAG 2.2 SC 2.5.8's
  24x24 minimum target size. They are now 24x24. The control column needed the
  extra room, so it now spans the axis band as well as the content area — the
  axis strip begins at `left: controlGutter`, leaving the gutter's own slice of
  that band empty — and the start/end buttons drop out when the drawer is too
  short to stack four controls.
- TimeNav marker dots had a hit area of roughly 12x12px. Vertical padding now
  brings it to 12x24. It is deliberately not widened to 24x24: dots are placed
  by date and can sit a few pixels apart, so 24px-wide targets would occlude
  each other's centres and make the earlier of two close events unreachable —
  worse for the users the criterion protects. Where dots are dense the label
  above is the accessible target; `--tl-nav-dot-target-x` widens them for
  timelines that are sparse enough to afford it.
- TimeNav leader lines failed WCAG AA. They were drawn at 0.5 opacity, fading
  the default marker colour to an effective `#9b9b9b` against the nav band —
  2.11:1 in light mode and 2.91:1 in dark, against the 3:1 required for
  non-text that carries meaning (a leader is what ties a label to its point on
  the track). Default opacity is now 0.7, the lightest value that clears the
  threshold in both themes; override with `--tl-nav-leader-opacity`.
- `loadTimeline()` never hydrated `blobRef`-backed media or backgrounds (images
  uploaded to a PDS rather than linked by URL) into fetchable URLs — only the
  authoring app did that hydration, for the signed-in user's own drafts. Any
  read-only playback of an `at://` timeline (embeds, share links) with an
  uploaded background or event image silently rendered without it. Blob
  references are now hydrated into `getBlob` URLs using the author's DID and
  resolved PDS at load time.
- `TimeNav` group-band labels (e.g. from TL3 `group` fields) were effectively
  invisible — the label gutter overlapped the zoom-controls column, which sat
  on top with an opaque background, hiding all but a sliver of each name.
  Labels now render clear of the controls, and a label too long for the
  gutter (e.g. "Social Media") floats over the timeline instead of being
  truncated with an ellipsis.
- The group with no `group` value could land in the middle of the group
  list, wherever its first event happened to fall chronologically. It's now
  always pinned to the last band.
- Dragging the nav handle down on a grouped timeline could make it *taller*
  instead of shorter, because grouped rows and the ungrouped fallback layout
  used different row heights. Shrinking the drawer below the height needed
  to show one row per group now drops grouping entirely and lays out events
  like an ungrouped timeline, using as many rows as actually fit — and the
  fallback height can never exceed the grouped height it replaces.

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
