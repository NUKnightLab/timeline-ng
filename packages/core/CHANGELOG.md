# Changelog

All notable changes to `@knight-lab/timeline-ng-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `FONT_PAIRINGS`, `getPairing()` and `coversLanguage()` — the 20 TimelineJS 3
  font pairings, re-extracted from TL3's own stylesheets and re-resolved
  against the modern Google Fonts API. A pairing is a set of `--tl-*` token
  values plus two pieces of metadata: `webfonts` (families a host must serve)
  and `scripts` (writing systems both faces actually cover). Nothing is
  loaded by the module itself.

  `coversLanguage()` exists so the authoring tool can warn an author whose
  language falls outside a pairing's coverage — most of these families are
  Latin and sometimes Cyrillic, so a Japanese or Arabic timeline renders from
  the fallback stack rather than the chosen face.

  Regenerate with `pnpm fonts:extract`.
- `TLSettings.navChrome` (`'full' | 'quiet' | 'minimal'`) and
  `TLSettings.highContrast`, replacing `TLSettings.skin`. A skin bundled three
  unrelated axes under one name, which is why none of them could be described
  to a user: measured by declaration, `bare` was 100% navigator (its two
  slide-layout declarations were dead, restating defaults), `quiet` was 25/37
  navigator plus a text-centring rule left over from an abandoned TimelineJS 3
  reproduction, and `contrast` was the only coherent one — because it was the
  only one that mapped to a single axis. The axes are now named separately and
  compose freely.
- `TLSettings.fontPairing`, typed as `FontPairingId` so the JSON schema
  validates against the shipped list without a hand-maintained duplicate.
- `PAIRING_ALIASES`. TimelineJS 3 shipped `default` as a byte-identical copy of
  `pt` — the same two faces under a second name — so 19 pairings are offered
  rather than 20, and `getPairing('default')` resolves to `pt`. `FontPairingId`
  keeps accepting `'default'`: what a record may name is deliberately a superset
  of what the picker offers, so an existing record never stops resolving.

- `TLSettings.skin` — selects a named visual skin in the player. Orthogonal to
  `TLSettings.theme`, which stays a light/dark choice.

### Fixed

- `fromTL3()` discarded any `settings` block. TimelineJS 3's own JSON has no
  such key, so anything present came from a timeline-ng file being read back
  in — which meant the authoring tool's file import silently dropped every
  setting an author had chosen. Downloading a timeline and re-importing it lost
  language, theme, reverse order, start slide, skin and font pairing. Settings
  now survive the round trip, field by field, with unrecognised values dropped
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
