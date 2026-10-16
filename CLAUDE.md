# timeline-ng — basic operations

Svelte 5 + TypeScript monorepo (pnpm workspaces). Run everything from the repo root.

## Run

| Command | What | URL |
|---|---|---|
| `pnpm authoring` | Authoring app against real ATProto (Bluesky etc.) | http://127.0.0.1:5173 |
| `pnpm authoring:devnet` | Authoring app against the local devnet PDS (start devnet first) | http://127.0.0.1:5173 |
| `pnpm embed` | Embed/player page: `?src=at://…` or `?src=https://…`, or `?preview` + `postMessage` | http://127.0.0.1:5200 |
| `pnpm og-preview` | Cloudflare worker (wrangler dev) for share-link OG cards | |
| `pnpm dev:og` | core watch + embed + og-preview together | |
| `pnpm contrast-lab` | Theme contrast audit tool | http://127.0.0.1:5310 |
| `pnpm dev` | Everything in parallel (~10 processes, usually overkill) | |

Example apps in `apps/` (`pnpm --filter @timeline-ng/<name> dev`): example-svelte5 :5300,
example-svelte5-json :5301, example-vanilla :5302, example-custom-theme :5303.

**Testing the authoring app end to end needs both `pnpm authoring` and `pnpm dev:og`.** Authoring's
preview/embed links point at the embed server (:5200) and its share links at the og-preview worker
(http://localhost:8787/ng/share, which redirects to :5200). With `pnpm authoring` alone, preview and
share links are dead.

The authoring and embed apps alias `core` and `player` to their `src/`, so edits there hot-reload
with no rebuild. `workers/og-preview` is the exception: it reads `packages/core/dist`.

Start long-running dev servers with `run_in_background`.

## Devnet (local PDS, Docker)

```sh
bash scripts/devnet-up.sh     # start
bash scripts/devnet-down.sh   # stop
```
Then `pnpm authoring:devnet` and sign in as e.g. `alice.devnet.test`. Details: `docs/atproto-devnet.md`.

## Check (same as CI)

```sh
pnpm typecheck
pnpm test:run                                   # all packages
pnpm --filter @knight-lab/timeline-ng-core exec vitest run src/background.test.ts   # one file
pnpm build
```

## Packages

| Path | npm name |
|---|---|
| `packages/core` | `@knight-lab/timeline-ng-core` (published) |
| `packages/player` | `@knight-lab/timeline-ng` (published) |
| `packages/authoring` | `@timeline-ng/authoring` |
| `packages/embed` | `@timeline-ng/embed` |
| `workers/og-preview` | `@timeline-ng/og-preview` |

## Release and deploy

- npm: push a git tag, and `publish.yml` publishes via OIDC. Don't run `npm publish` by hand.
  See `docs/publishing.md`.
- Site: `scripts/deploy.sh stg|prd` (needs the AWS CLI).
- Record user-visible changes in the `## [Unreleased]` section of `packages/core/CHANGELOG.md` /
  `packages/player/CHANGELOG.md` as you make them.
