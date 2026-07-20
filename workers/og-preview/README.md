# @timeline-ng/og-preview

A Cloudflare Worker that generates social-sharing previews for Timeline NG.

The embed page ([packages/embed](../../packages/embed)) is a single static
HTML shell that loads its timeline JSON client-side via a `src` URL param —
crawlers (Facebook, Slack, X, etc.) don't run that JS, so they can never see
per-timeline title/image/description. This worker sits in front of a `/ng/share`
path, fetches the timeline data itself (same `at://` / `https://` resolution
as the embed), and returns real `og:*`/`twitter:*` meta tags. Human visitors
get the same response, then get redirected into the actual interactive
player — no user-agent sniffing, so there's nothing that could be considered
cloaking.

Deployed in production at `https://timeline.knightlab.com/ng/share`, alongside
the embed page at `https://timeline.knightlab.com/ng/embed/`.

## Usage

```
GET /ng/share?src=<at:// URI or https:// URL>[&plc=...][&resolver=...]
```

`src`, `plc`, and `resolver` mirror the embed page's own query params exactly
— any embed URL can be turned into a preview URL by swapping the path and
keeping the query string as-is.

Add `&debug=1` to inspect the page in a normal browser tab: it skips the
redirect and prints the extracted title/description/image as visible HTML
instead. Without it, the redirect fires in well under a second, so the tags
are only really visible via "View Source", `curl`, or an actual crawler (real
social scrapers don't run JS or follow `<meta http-equiv="refresh">`, so they
just read the `<head>` and stop — that's what `debug=1` is standing in for).

## Local development

No Cloudflare account is required for this — `wrangler dev` runs a full
local emulation of the Workers runtime (via `workerd`), with real network
access, so `at://`/PDS/DID resolution works exactly as it will in production.

```sh
pnpm dev
```

This starts the worker on `http://localhost:8787`. To see the full redirect
land somewhere real, also run the embed dev server in another terminal:

```sh
pnpm --filter @timeline-ng/embed dev   # http://127.0.0.1:5200
```

Then hit, e.g.:

```
http://localhost:8787/ng/share?src=at%3A%2F%2Fdid%3Aplc%3Axcinm6zyywmiymjyz67qgm72%2Fcom.knightlab.timeline%2Fmr6t86qd66rf
```

`EMBED_BASE_URL` in [wrangler.jsonc](wrangler.jsonc) controls where the
redirect points; the top-level `vars` (used by `wrangler dev`) default to the
local embed dev server's address, and `env.production.vars` overrides it to
the real embed URL for the deployed worker.

## Deploying

```sh
pnpm deploy   # wrangler deploy --env production
```

Ships to `https://timeline.knightlab.com/ng/share*`, per the `routes` entry
under `env.production` in `wrangler.jsonc` (zone `knightlab.com`). Requires
`wrangler login` (browser OAuth against the Cloudflare account that owns that
zone) the first time from a given machine.

## Notes

- Only `at://` and `https://` sources are accepted (bare `http://` is not,
  unlike the client-side loader) — this fetch now happens server-side at the
  edge rather than in the visitor's browser, so it's held to a slightly
  stricter standard.
- The `at://` resolution logic in [src/atproto.ts](src/atproto.ts)
  intentionally duplicates [loader.ts](../../packages/player/src/lib/loader.ts)
  rather than importing `@knight-lab/timeline-ng` — that package pulls in
  Svelte and DOMPurify, which don't belong in a Workers bundle. Keep the two
  in sync if the resolution logic changes.
- Responses are served with `Cache-Control: public, max-age=300`. There's no
  edge/KV caching yet — worth adding later if crawler traffic volume makes
  it worthwhile.
