# Changelog

All notable changes to `@knight-lab/timeline-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **The navigator's leader lines are shorter, and the navigator itself is
  16px less tall.** The band the marks sit in reserved 44px with the track
  line drawn across its middle, so every leader paid a 22px tail on top of
  the rows or bands between its label and the track. The marks never needed
  that: a dot is 12px, 16.8px while active, a span bar 10px, leaving around
  16px empty above and below. The band is 28px now, which shortens every
  leader by 8px and gives the height back — measured on a three-group
  timeline the leaders went from 64/44/24 to 56/36/16, and on an ungrouped
  one from 88/62/36 to 80/54/28. An active dot still clears by 5.6px. The
  axis follows on its own, being positioned from a `--tl-axis-track-offset`
  derived from the same constant. Not smaller still because this band is also
  the drag surface for panning the track.

### Fixed

- **The prev/next controls no longer cover the navigator's end markers.** They
  are positioned against the stage, which spans the whole player, the navigator
  included — `SlideContent` already pads its text clear of it using the same
  `--tl-nav-overlap`, and these did not. Nothing was drawn over the navigator
  while `--tl-btn-bg` was `transparent`, so it went unseen; `contrast='high'`
  gives the control an opaque fill, and each button became a 2.5rem column of
  solid white sitting on the first and last markers. They now stop at the top
  of the navigator, which costs no horizontal room and sends a click over the
  navigator to the navigator rather than paging the slide.
- **Overlapping navigator labels spread into the free space beside them.** A
  group band is one row, so where the shift budget could not separate two
  labels they were drawn on top of each other — most visibly when two events in
  a group share a date, which rendered as a single label with two leader lines.
  The packer's search only moves rightward, correctly: everything to a label's
  left is already placed, so a leftward candidate cannot succeed where its
  natural position failed. What it could not do was reconsider a label already
  placed, and that is the one with the free space beside it — the earlier of
  the pair, committed before the packer knew the second was coming. A second
  pass now walks back along the row and pulls that neighbour left, repeating so
  the slack travels down a whole cluster, bounded by each label's own shift
  budget, the viewport edge, and the label before it.
- **Navigator labels no longer render out of date order.** A label that could
  not be placed within the budget fell back to its natural position, which
  could put it left of a predecessor that had been shifted right — two labels
  in the wrong order, reading as two wrong dates. The fallback now holds the
  row's order wherever the budget can pay for it. It cannot always: a wide
  label near the right edge is clamped to `100 - halfPct` and may be unable to
  sit as far right as a narrower neighbour, which is geometry rather than
  something to fix.
- **Overlapping labels stack by date, earliest on top.** They all shared one
  z-index, so DOM order decided which was clipped — array order, which nothing
  sorts by date. The earlier event now wins the overlap and the later one is
  clipped, and the active slide's label is above every resting label whatever
  its date. Tunable only in the sense that the order is now explicit rather
  than incidental.

## [0.5.0] - 2026-10-19

### Changed

- **The text scrim's edges fade instead of ending in a rectangle.** Raising the
  scrim to 72% fixed the contrast but made the panel read as a dark box laid
  over the photo, which is most of the reason to set a background image at all.
  The fill is now masked — two linear masks intersected — so it holds full
  strength across the whole text box and fades to nothing through the padding.
  This is a mask over a flat fill rather than a gradient in `background`: every
  ratio measured for the scrim assumes the full alpha sits behind the glyphs,
  and a background gradient would dim that. The plateau reaches full strength
  at 60% of the padding, leaving the remainder as margin between the fade and
  the first glyph, so no measured value changes. The padding grows to make room
  — `clamp(1.5rem, 6cqw, 4.5rem)` horizontally, `clamp(1.25rem, 4cqw, 3.5rem)`
  vertically, scaled off the player's own width — because a fade inside the old
  1.25rem/1.5rem is about 20px and reads as a soft-edged rectangle rather than
  a falloff. At narrow widths the clamp floors return the padding to what it
  was. Where `mask-composite` is unsupported the declarations drop and the
  panel renders flat, as it did before: degradation costs the softness, never
  the contrast. Slides with no background image are unaffected.

- **The navigator reserves the room each label actually needs.** The label
  packer treated every label as 130px wide — the CSS `max-width` — so
  "Belfield 50" (66px) claimed as much of the track as the longest possible
  headline. Labels were pushed off their true date, or dropped, to avoid
  collisions that would never have happened, and a short label near the edge
  was pulled 65px inward when its own half-width is 33px. Each label's width is
  now measured from a hidden mirror of the real button, capped at 130px as
  before, and the packer uses that width per label — for its collision test and
  for the viewport-edge clamp alike. Horizontal position still encodes time:
  nothing moves that did not have to, and labels that are genuinely on top of
  each other still get a leader line rather than a new date. Measuring is
  driven by the label text and a `ResizeObserver`, never by the viewport, so
  panning and zooming do no measurement at all.
- **The high-contrast navigator groups by zebra striping, not rules.** Every
  group band drew a full-bleed black 1px rule, so a three-group timeline
  stacked three of them on top of the nav rule, the axis rule and the track
  line — six horizontal lines in a 130px drawer. Bands now alternate a soft
  fill and the group name carries the contrast. Only `contrast='high'` changes;
  every other theme renders exactly as before.
- **No rule above the axis in high contrast.** `.tl-nav__track::before` already
  draws the marker line ~20px above it at full contrast, so the two bracketed
  the tick labels as parallel blacks. The track line keeps the edge.
- **Text over a background image is legible whatever the photo.** The scrim
  behind the text column was 40% black, which made the text's contrast a
  property of the author's image rather than of the player: over a pale photo
  the date measured **1.84:1**, the body 2.41:1 and the headline 2.96:1, all
  failing WCAG 1.4.3 — and in both themes, since the photo covers the theme's
  own background. The default is now 72% black, the figure that holds for the
  lightest possible photo, putting the three at 5.79:1, 7.58:1 and 9.29:1 in
  the worst case. It is a heavier panel than before; the scrim covers only the
  text column, so the image is still visible around it and behind the media.
  Tunable with `--tl-slide-text-scrim`, which `contrast='high'` already takes
  to 92%. Slides with no background image are unaffected.
- **The text scrim's blur is the same in every browser.** `backdrop-filter`
  said `blur(2px)` and `-webkit-backdrop-filter` said `blur(4px)`, so Safari
  blurred twice as hard as Chrome and Firefox. Both now read
  `--tl-slide-text-scrim-blur`, default 2px.
- **Body-copy styling has one definition.** The rules for author-written HTML
  now live in `styles/prose.css`, keyed by a `tl-prose` class that the slide
  body carries — and that the authoring editor applies too, so what is typed is
  set the way it will be published. They are bundled into `styles.css` as
  before, so nothing changes for embedders.

### Added

- **The scrim's shape is themeable.** `--tl-slide-text-scrim-pad-x` /
  `--tl-slide-text-scrim-pad-y` set the panel's padding, which is also the
  fade's runway, and `--tl-slide-text-scrim-fade` sets how far into that
  padding the fade reaches, as a fraction of it (default `0.6`). `0` collapses
  the mask to the hard-edged rectangle this replaced.

- **A swept token surface for high contrast.** A sweep of the player's
  component `<style>` blocks found more visual values hardcoded there, beyond
  the reach of `contrast='high'` — or of any other skin. Each is now a
  `--tl-*` token whose default is the literal the component shipped with, so
  every other theme renders byte-identically: `--tl-nav-grip-opacity` /
  `--tl-nav-grip-hover-opacity`, `--tl-nav-span-bar-opacity` /
  `--tl-nav-span-bar-hover-opacity`, `--tl-nav-label-hover-ring` /
  `--tl-nav-label-active-hover-ring`, `--tl-btn-bg`, `--tl-btn-color`,
  `--tl-btn-text-shadow`, `--tl-bsky-card-nested-bg`, and
  `--tl-slide-dark-text`, `--tl-slide-dark-text-muted`,
  `--tl-slide-dark-headline`, `--tl-slide-dark-body`, `--tl-slide-dark-date`
  for a slide with a dark or image background.
- **The Bluesky card's palette is themeable.** `--tl-bsky-card-bg`,
  `--tl-bsky-card-border`, `--tl-bsky-card-text`, `--tl-bsky-card-muted` and
  `--tl-bsky-card-link` existed but were *declared* on the card element, which
  out-specifies anything inherited from `.tl-player` — so no theme could reach
  them. They are fallbacks at the point of use now, with the same defaults.
- `--tl-nav-group-name-color`, `--tl-nav-group-name-opacity` and
  `--tl-nav-group-name-weight` expose the navigator's group label, which was
  styled entirely from hardcoded values. All three default to those values.

### Fixed

- **Every event in the navigator is reachable, and only once.** A mark (dot or
  span bar) is hidden from assistive tech while its label is present, so the
  nav offers one tab stop per event rather than two; the mark takes the control
  role only when no label stands in for it. That covered the packer dropping a
  label for a collision, but not the case where there are no label rows at all
  — a compact player, or one whose drawer the reader has dragged shut — where
  the whole label block is gated out. The marks whose labels the packer *had*
  placed stayed `aria-hidden` with `tabindex="-1"` and nothing in their place,
  so those events were reachable by neither keyboard nor screen reader. On the
  13-event test timeline, 2 of 13 were unreachable in the standard navigator
  and 3 of 13 in `navChrome='minimal'`. The role is now derived where the mark
  renders rather than folded into the label-layout state, which the row count
  is itself computed from — making it depend on the row count latches the
  drawer shut once it reaches zero.

- **Navigator dots and span bars respond to hover.** Neither did. The span bar
  had a `:hover` rule whose default equalled its resting opacity, so it was a
  no-op; the dot had no `:hover` rule at all, only a `background` transition on
  its `::before` that nothing ever changed. The label was the only mark in the
  navigator that answered the pointer. Both marks now take
  `--tl-color-nav-marker-hover`, the token the label already used and the one
  every skin calibrates against its own nav background — the bar across both
  borders and the rule between them, since that is what draws it. An active
  mark keeps its own colour on hover, as the active label does, rather than
  trading the signal saying which slide you are on for one the cursor already
  gives. `--tl-nav-span-bar-hover-opacity` still applies and still defaults to
  the resting `0.75`, so a theme already lifting the bar's opacity is
  unaffected. Resting states are unchanged in every theme.

- **The minimal navigator's labels are readable again.** `navChrome='minimal'`
  set `--tl-nav-label-bg: transparent`, on the theory that a label with no band
  behind it should sit directly on the stage. What actually happened is that
  the track line, the marker line above it and every leader ran straight
  through the lettering, and a label overlapping a neighbour's leader was
  unreadable. Labels now carry an opaque chip in `--tl-color-nav-bg`, which
  this skin already sets to the stage background — invisible as a shape, but it
  knocks those lines out from behind the text. The label rings stay off.
  `contrast='high'` was never affected: it sets `--tl-nav-label-bg` itself.
  Only `navChrome='minimal'` changes; `'standard'` renders as before.

- **The slide date is legible on dark and image backgrounds in high contrast.**
  A dark-background slide flips the slide's text palette, but it had no
  `--tl-date-color`; nothing sets that token in the default themes, so the date
  fell through to `--tl-color-text-muted` and came out right by accident. The
  high-contrast skin does set it, at player level, which defeated the fallback
  and left the date at #262626 on the author's dark background — **1.09:1**, and
  1.22:1 over an image scrim. Now 16.52:1 and 18.42:1 respectively. Default
  themes are unaffected.
- **The navigator's drag handle meets 1.4.11 in high contrast.** The grip was a
  hardcoded `opacity: 0.2`, computing to #cccccc on the nav — **1.61:1** light
  and 1.66:1 dark, for an interactive control that owes 3:1. Now 21:1.
- **The prev/next and fullscreen controls are visible on a light surface in
  high contrast.** The glyphs are white, separated from whatever is behind them
  by a blurred drop shadow — which is not a measurable contrast. On a light
  background they were white on white, **1.00:1**. In high contrast they now
  take an opaque fill, so the ratio is a property of the token set rather than
  of whatever media happens to be behind them: 21:1 in both themes.
- **Hovering a navigator label no longer erases its high-contrast outline.** The
  hover halo is a knockout in the nav's own colour, and at `(0,2,0)` it
  out-specified both `--tl-nav-label-ring` and `--tl-nav-label-active-ring` — so
  hovering a label in the one mode that draws a boundary removed it, **1:1**.
  The knockout is kept for separation with the edge drawn outside it, 21:1.
- **Text over a background image no longer depends on the photo in high
  contrast.** The text scrim is 40% black, so over a near-white image the body
  measured **2.33:1** and the headline 2.85:1. High contrast takes the scrim to
  92%, giving 15.04:1 and 18.42:1 regardless of the image.
- **The Bluesky card reaches AAA in high contrast.** Its text cleared AA but not
  the 7:1 the mode promises — handle **6.12:1**, link **5.69:1** — and its
  border was **1.30:1** light, 1.01:1 dark. Now 15.13:1, 10.04:1 and 21:1.

- **Group names are legible in the high-contrast navigator.** The label shipped
  at `--tl-color-text-muted` × `0.55` opacity, computing to #888 on white —
  3.54:1 at 9.6px, which fails WCAG AA in the one mode that promises AAA. In
  the mode where group identity should be loudest, the group names were the
  faintest text on screen and the band rules were compensating for them. Now
  21:1.
- **Links in body copy are underlined again.** The isolation reset strips
  `text-decoration` from every anchor so a host page cannot restyle the player's
  own controls, and only colour was being restored — leaving body-copy links
  identified by colour alone, which fails WCAG 1.4.1 unless link and body text
  differ by 3:1. Tunable with `--tl-body-link-decoration` and
  `--tl-body-link-underline-offset`.
- **Headings, code and horizontal rules in body copy are styled.** These had no
  rule at all and fell back to browser defaults — an authored `<h1>` rendered at
  2em with large margins, competing with the slide's own headline and ignoring
  the theme's type scale. Headings are now sized relative to body copy and set
  in the heading face; `code`, `pre` and `hr` pick up the theme. See
  `--tl-body-heading-size`, `--tl-body-subheading-size`,
  `--tl-body-heading-weight`, `--tl-font-mono`, `--tl-code-bg` and `--tl-rule`.
- **List markers in body copy are visible again.** Same cause as blockquote:
  `base.css` strips `list-style` so a host page's navigation lists cannot
  inherit it, which also left an authored bullet or numbered list looking like a
  run of paragraphs. Body copy now restores markers and an indent, tunable with
  `--tl-list-indent`, `--tl-list-style-bullet` and `--tl-list-style-number`.
- **Blockquotes in body copy are visible again.** `base.css` flattens
  `blockquote` so a host page's styles cannot bleed into a slide, which also
  meant an authored quote rendered identically to a paragraph — the tag was in
  the markup and nothing showed on screen. Body copy now restores an indent,
  rule and italic, tunable with `--tl-blockquote-indent`, `--tl-blockquote-rule`,
  `--tl-blockquote-font-style` and `--tl-blockquote-color`.

## [0.4.0] - 2026-08-25

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
  controls and date axis and reclaims the space they occupied — 44px of gutter
  and 18px of axis band, nav height 106 to 88.

  Deliberately not part of `TLSettings`, so it is not something an author can
  choose. Most real timelines are dense enough that the navigator must drop
  some labels, and zooming is how a reader gets them back, so removing the zoom
  controls has a cost an author cannot see when choosing it. It stays a prop
  for embedders who know their own timeline is sparse.

- **`highContrast` prop**, raising text and marks to WCAG AAA: worst measured
  case 15.13:1 in light and 15.91:1 in dark. It spans slide and navigator
  alike and is applied last, so where it disagrees with a pairing or a nav
  treatment about a color it wins — an accessibility mode a styling choice
  could override would not be one.

  The three axes above are orthogonal to each other and to `theme`, and each
  is a set of token values selected by its own data attribute on the player
  root. The cascade runs base defaults < pairing < navChrome < highContrast <
  embedder.

- **A much wider token surface**, so those layers need no component overrides.
  New: the nav's top border, label chip fill/ring/radius/padding, zoom gutter
  fill and border, axis strip background, border and tick color, leader,
  track opacities, group band border and tint, marker and button
  target sizes, `--tl-nav-dot-active-scale`, `--tl-date-transform`,
  `--tl-headline-transform`, `--tl-headline-color`, `--tl-body-color` and the
  `--tl-slide-text-only-*` trio.
- `--tl-focus-ring-width`, `--tl-focus-ring-offset` and `--tl-focus-ring-color`,
  replacing five hardcoded `2px solid var(--tl-color-accent)` declarations
  across three components. A focus ring's weight and offset were previously
  unreachable.
- `--tl-nav-mark-active`, separating the active *mark* color (dot, span bar,
  leader stroke) from `--tl-color-nav-marker-active`, which now
  sets only the active label's text. One token drove both, which made a
  light-on-dark active label impossible — inverting the label also turned the
  active dot white on a white nav and erased it. Defaults to
  `--tl-color-nav-marker-active`, so existing overrides are unaffected.

### Changed

- **The navigator no longer hijacks the scroll wheel.** A plain wheel now
  scrolls the page; zooming takes Ctrl (or ⌘) + wheel, and a trackpad pinch
  still works since those arrive as ctrl-modified wheel events. Hijacking the
  wheel meant a reader scrolling an article past an embedded timeline got
  caught by it — the same reason Google Maps and Mapbox both adopted
  cooperative gestures. A short overlay appears when someone tries a plain
  wheel over the navigator, naming the modifier for their platform, and fades
  after two seconds; it is not standing chrome. New locale strings
  `timeline.zoom_hint` and `timeline.zoom_hint_touch`.

- The navigator's zoom minimap is gone — the 4px strip along its bottom edge
  showing which slice of the date range was in view. It was drawn at 0.12
  opacity, had no click or drag handling, no accessible name, and only
  appeared on ungrouped timelines. The axis labels already say where you are,
  in words.

- **Slide content is vertically centered** in the stage, matching TimelineJS 3,
  rather than pinned to the top; media and text columns center against each
  other too. Centering uses auto block margins rather than
  `justify-content: center`, so a slide taller than the stage still scrolls
  from its true top instead of clipping it out of reach. Set
  `--tl-slide-valign: 0` and `--tl-slide-media-align: start` for the previous
  behavior.
- **The slide date is no longer a bold, uppercase, letter-spaced eyebrow.** It
  was among the loudest things on a slide when it should be among the
  quietest; it is now plain sentence case at reading size (0.9375rem/400).
  Reachable through `--tl-date-size`, `--tl-date-weight`,
  `--tl-date-tracking` and `--tl-date-transform`.
- **Body copy is a step lighter than the headline** rather than sharing its
  color — `#111111`/`#3d3d3d` light and `#f8f8f8`/`#d2d2d2` dark, measuring
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
- An active nav label keeps its color on hover and focus instead of taking
  the generic hover color, which is calibrated against the nav background
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
  - Zoom centered on the middle of the viewport, so a timeline bunched at one
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

[Unreleased]: https://github.com/NUKnightLab/timeline-ng/compare/player-v0.5.0...HEAD
[0.5.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.4.0...player-v0.5.0
[0.4.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NUKnightLab/timeline-ng/releases/tag/v0.1.0
