# Changelog

All notable changes to `@knight-lab/timeline-ng-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Font pairings.** `FONT_PAIRINGS`, `getPairing()`, `coversLanguage()`,
  `PAIRING_ALIASES` and the `FontPairing` / `FontPairingId` types. These are
  TimelineJS 3's font sets, re-extracted from TL3's own stylesheets and
  re-resolved against the modern Google Fonts API. 19 are offered; TL3 shipped
  `default` as a byte-identical duplicate of `pt`, so that id survives as an
  alias rather than a second entry.

  A pairing is a set of `--tl-*` token values plus two pieces of metadata:
  `webfonts` (families a host must serve) and `scripts` (writing systems both
  of its faces actually cover). The module loads nothing itself.

  `coversLanguage()` exists so an authoring tool can warn before publishing:
  most of these families are Latin and sometimes Cyrillic, so a Japanese or
  Arabic timeline renders from the fallback stack rather than the chosen face.

  Regenerate with `pnpm fonts:extract`.

- **Presentation settings.** Three independent axes on `TLSettings`, each
  composing freely with the others and with `theme`:
  - `fontPairing` — which faces render. Typed as `FontPairingId`, so the JSON
    schema validates against the shipped list with no hand-maintained
    duplicate to drift.
  - `navChrome` — `'standard'` or `'minimal'`. Minimal drops the zoom
    controls, date axis and minimap from the navigator entirely.
  - `highContrast` — raises the player to WCAG AAA.

### Fixed

- `fromTL3()` discarded any `settings` block. TimelineJS 3's own JSON has no
  such key, so anything present came from a timeline-ng file being read back
  in — which meant the authoring tool's file import silently dropped every
  setting an author had chosen. Downloading a timeline and re-importing it lost
  language, theme, reverse order and start slide. Settings now survive the
  round trip, validated field by field, with unrecognised values dropped
  rather than passed to the player.

## [0.3.0] - 2026-07-28

### Added

- `toTL3CSV`, the reverse of `fromTL3CSV`: serializes a `TLTimeline` back to
  a TimelineJS3 CSV export. Used by the authoring app's "Download as CSV"
  option for people who can't self-host JSON — the CSV can be imported into
  a Google Sheet and published from there instead.
- `fromTL3CSV` and `toTL3CSV` both read/write the TL3 `Alt Text` column
  (between `Media Thumbnail` and `Type`) into `media.alt`.

### Fixed

- `resolveMedia` now recognizes Wikipedia file-page and `#/media/` lightbox
  URLs whose "File" namespace is localized (e.g. German `Datei:`, French
  `Fichier:`), not just the English `File:` prefix. Detection now keys off
  the image file extension instead of a hardcoded namespace name, so it
  works for any language wiki — this also fixes such URLs being unusable as
  slide background images, since `resolveBackgroundImageUrl` relies on the
  same `wikipediaimage` classification.

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

[Unreleased]: https://github.com/NUKnightLab/timeline-ng/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/NUKnightLab/timeline-ng/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NUKnightLab/timeline-ng/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NUKnightLab/timeline-ng/releases/tag/v0.1.0
