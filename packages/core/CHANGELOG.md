# Changelog

All notable changes to `@knight-lab/timeline-ng-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-07-22

### Added

- `normalizeTimelineSourceUrl` and `parseTimelineText`, shared helpers that
  rewrite a Google Sheets "publish to the web" link to its CSV export
  endpoint and sniff/parse fetched timeline text as CSV or JSON. Used by
  `@knight-lab/timeline-ng`'s `loadTimeline` and the authoring app's URL
  import so a plain `pubhtml` link works as a timeline source without any
  manual URL editing.

## [0.2.0] - 2026-07-20

### Added

- `fullscreen.enter` / `fullscreen.exit` locale strings (en, es), for the
  new full-screen toggle in `@knight-lab/timeline-ng`'s `SlidePlayer`.

### Fixed

- `resolveMedia` now recognizes a Wikipedia `File:` page URL directly (not
  just the `#/media/File:` lightbox form or a Wikimedia Commons file), and
  captures the source language so callers can fall back to the local-wiki
  API when a fair-use/non-free image exists only there and not on Commons
  ([#4](https://github.com/NUKnightLab/timeline-ng/issues/4)).

## [0.1.0] - 2026-07-04

Initial public release. Earlier history predates this changelog; see
`git log` for detail.

[Unreleased]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NUKnightLab/timeline-ng/releases/tag/v0.1.0
