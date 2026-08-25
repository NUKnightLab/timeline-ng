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
pnpm fonts:fetch     # download slices + licenses, emit stylesheets
```

`fetch-fonts.mjs` skips downloading files already present, but still hashes
every one of them, so re-running is both cheap and a full integrity check. The
provenance of every file — family, weight, style, script slice, source URL and
SHA-256 — is in `scripts/fonts/manifest.json`.

## Integrity

Each file's SHA-256 is pinned in the manifest, recorded the first time the
bytes were seen. Every later run verifies against it and exits non-zero on a
mismatch. This is what makes the mirror recoverable rather than merely present:
without it, a truncated or corrupted file is indistinguishable from a good one,
and an upstream that has quietly republished looks the same as one that has
not.

If a check fails, delete the offending file and re-run `pnpm fonts:fetch` to
restore it from its pinned URL. If upstream genuinely republished the face —
Google's URLs are versioned, so this should be rare — re-run
`pnpm fonts:extract` to re-resolve and re-pin, and expect the change to show
up in the manifest diff where it can be reviewed.

## Licensing

Committing these files is redistribution, which both licenses in use require
be accompanied by their text and copyright notice. `LICENSES/` holds the
upstream license for all 32 families, fetched from the `google/fonts`
repository, with `LICENSES/README.txt` as a human-readable index and
`LICENSES/index.json` as the machine-readable one.

31 families are SIL Open Font License 1.1 or Apache 2.0; Ubuntu is under the
Ubuntu Font License 1.0. All three permit redistribution. `fetch-licenses.mjs`
exits non-zero if any family's license cannot be resolved — an unresolved
family must not ship.
