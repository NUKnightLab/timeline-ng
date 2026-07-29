# Changelog

All notable changes to `@knight-lab/timeline-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
