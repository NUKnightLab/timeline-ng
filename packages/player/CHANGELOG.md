# Changelog

All notable changes to `@knight-lab/timeline-ng` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NUKnightLab/timeline-ng/releases/tag/v0.1.0
