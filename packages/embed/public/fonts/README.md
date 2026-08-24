# Self-hosted fonts

These files back the TimelineJS 3 font pairings in
`@knight-lab/timeline-ng-core` (`FONT_PAIRINGS`).

## What these files are

The `.woff2` files are **byte-for-byte copies of what fonts.gstatic.com
serves** — downloaded once, verified by SHA-256 against the upstream response,
and committed. Nothing is re-encoded, subsetted or otherwise derived. At
display time no request reaches Google: the browser loads these from the same
origin as the embed.

Each `<pairing>.css` declares the `@font-face` rules for one pairing, with
every slice's `unicode-range` preserved exactly as Google publishes it. That
is what keeps the per-viewer cost small without restricting anything to Latin:
a browser downloads only the script slices the timeline's text actually uses,
so a Cyrillic timeline pulls the Cyrillic slice and never touches Latin.

For comparison, TimelineJS 3 hotlinks whole TrueType files with no
unicode-range at all — its default pairing declares 967 KB of TTF against
62 KB of woff2 here.

## Regenerating

```
pnpm fonts:extract   # re-read TL3's sets, re-resolve against Google Fonts
pnpm fonts:fetch     # download slices + licences, emit stylesheets
```

`fetch-fonts.mjs` skips files already present, so re-running is cheap and only
picks up what changed. The full provenance of every file — family, weight,
style, script slice and source URL — is in `scripts/fonts/manifest.json`.

## Licensing

Committing these files is redistribution, which both licences in use require
be accompanied by their text and copyright notice. `LICENSES/` holds the
upstream licence for all 32 families, fetched from the `google/fonts`
repository, with `LICENSES/README.txt` as a human-readable index and
`LICENSES/index.json` as the machine-readable one.

31 families are SIL Open Font License 1.1 or Apache 2.0; Ubuntu is under the
Ubuntu Font License 1.0. All three permit redistribution. `fetch-licenses.mjs`
exits non-zero if any family's licence cannot be resolved — an unresolved
family must not ship.
