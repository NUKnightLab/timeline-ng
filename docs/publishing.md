# Publishing @knight-lab/timeline-ng-core and @knight-lab/timeline-ng

This repo publishes two packages to npm:

- `@knight-lab/timeline-ng-core` (`packages/core`) — media resolution, schema,
  and other framework-agnostic logic.
- `@knight-lab/timeline-ng` (`packages/player`) — the Svelte player, which
  depends on core.

`packages/authoring` and `packages/embed` are `"private": true` and are never
published to npm — they're built and deployed directly from source. See
[Why authoring/embed order doesn't matter](#why-authoringembed-order-doesnt-matter)
below.

## Order of operations

**Publishing is automated by CI ([`.github/workflows/publish.yml`](../.github/workflows/publish.yml)).
Pushing a `v*.*.*` tag is what triggers it — don't run `npm publish` by hand.**
The workflow checks out the tagged commit, `pnpm install`s, runs `pnpm build`
and `pnpm test:run` across the whole monorepo as a gate, then runs
`pnpm --filter @knight-lab/timeline-ng-core publish --no-git-checks` followed
by `pnpm --filter @knight-lab/timeline-ng publish --no-git-checks` — core
before player, in that order, in a single job run. It authenticates via npm
Trusted Publishing (OIDC), so there's no local token or OTP prompt involved.
`pnpm publish` also does the `workspace:*` → exact-version rewrite described
below, and running both publishes in one job means core is guaranteed to
already exist on the registry (from the same run, moments earlier) by the
time player's manifest is rewritten and pushed — no manual "wait and verify"
step needed.

Why core-before-player matters at all: player's `package.json` depends on
core via `"workspace:*"`. `pnpm publish` rewrites that to the *exact* version
string from core's local `package.json` at publish time (not a range —
`workspace:*` becomes e.g. `"0.2.0"`, not `"^0.2.0"`). If core 0.2.0 weren't
live on the registry yet, anyone who `npm install`s the newly published
player would get a dependency resolution failure, since nothing satisfies an
exact pin to a version that doesn't exist. The workflow's fixed step order
(core's publish step runs to completion before player's starts) is what
guarantees this.

Because the pin is exact, a future *patch* release of core alone (say
0.2.1) does **not** automatically reach anyone who installed player 0.2.0 —
they're still pinned to core 0.2.0. If you want consumers to pick up core
patches without a player republish, change player's dependency to
`"workspace:^"` (→ published as `"^0.2.0"`) instead of `"workspace:*"`. That's
a deliberate tradeoff to make consciously, not part of routine publishing.

If only core changed (no player-visible changes), you can still tag a
release — `pnpm publish` for a package whose current version is already on
the registry is a safe no-op ("There are no new packages that should be
published"), so re-running the workflow only actually publishes what
changed. There's no need to hand-bump player's version just to keep the two
in sync.

## Release checklist

1. **Make sure everything intended for the release is committed.** Check
   `git status` and `git diff` — don't tag a release with unrelated
   uncommitted work sitting in the tree.
2. **Update CHANGELOG.md in each changed package** (`packages/core/CHANGELOG.md`,
   `packages/player/CHANGELOG.md`). Move the `[Unreleased]` entries under a
   new `## [x.y.z] - YYYY-MM-DD` heading, and update the link references at
   the bottom of the file. Leave a fresh empty `[Unreleased]` section at the
   top for future work.
3. **Decide the version bump per [semver](https://semver.org/):**
   - `patch` — bug fixes only, no new exported surface.
   - `minor` — new features or additive/non-breaking API surface (new
     optional fields, new exports, new locale strings).
   - `major` — anything that breaks existing consumers. Both packages are
     pre-1.0, so breaking changes can also just bump `minor` per semver's
     0.x.y convention, but call it out clearly in the CHANGELOG either way.
   - If core and player both change, they don't need matching version
     numbers — bump each independently based on its own CHANGELOG. (They
     happened to both start at 0.1.0 and may drift apart over time; that's
     fine.)
4. **Bump `version` in `package.json`** for each package being released.
5. **Sanity-check locally before pushing** (CI re-runs this, but catch
   failures early):
   ```sh
   pnpm --filter @knight-lab/timeline-ng-core test:run
   pnpm --filter @knight-lab/timeline-ng-core typecheck
   pnpm --filter @knight-lab/timeline-ng-core build

   pnpm --filter @knight-lab/timeline-ng typecheck
   pnpm --filter @knight-lab/timeline-ng build
   ```
6. **Commit and push** the changelog + version bumps (and any remaining
   feature work) to `main` — this repo doesn't use a separate "release
   commit" convention beyond that.
7. **Tag and push the tag** — this is what actually triggers publishing:
   ```sh
   git tag v<version>   # repo convention so far: one tag shared across
                         # a release even though packages version
                         # independently — see existing v0.1.0, v0.2.0 tags
   git push origin main --tags
   ```
8. **Watch the workflow run:**
   ```sh
   gh run list --workflow=publish.yml --limit 1
   gh run watch          # or: gh run view <run-id> --log
   ```
9. **Verify the new versions are live:**
   ```sh
   npm view @knight-lab/timeline-ng-core version
   npm view @knight-lab/timeline-ng version
   ```

### Manual/emergency fallback

If CI is broken and you must publish by hand, `cd packages/core && npm
publish`, verify with `npm view`, then `cd packages/player && npm publish`.
This requires local npm auth (`npm whoami`) and the **first** publish in a
while needs to happen interactively, in a real terminal, by whoever owns the
npmjs.com account — the registry requires a one-time-password/browser
approval (`EOTP`), and npm deliberately redacts the approval URL from all
output and logs, so an agent can't complete it on your behalf. npm remembers
a successful approval for a few minutes afterward, so publishing core and
then player back-to-back usually only prompts once. Prefer the tag-push path
above whenever CI is available.

## Why authoring/embed order doesn't matter

`packages/authoring` (the CMS/editor app) and `packages/embed` (the iframe
embed bundle) both depend on core/player via `"workspace:*"` too, but they're
`"private": true"` — never `npm publish`ed. When you `vite build` them, pnpm's
workspace linking means the build pulls directly from each package's local
`dist/` (or source, in dev) inside this monorepo. **It never touches the npm
registry.** So:

- Deploying authoring or embed always bundles whatever is currently built
  on disk in this repo — regardless of whether that version has been
  published to npm yet, or ever will be.
- The only real risk is *drift*, not breakage: if you deploy authoring/embed
  from a commit where core/player have diverged from what's published on
  npm (e.g. you merged more changes after publishing, or you deploy before
  publishing), the hosted authoring tool and the embeds it produces will run
  code that npm consumers of `@knight-lab/timeline-ng` don't have yet (or
  have a slightly different version of). That's a "which commit did I deploy
  from" bookkeeping question, not a build failure — the embed bundles its
  own JS either way.
- Practical implication: deploy authoring/embed from the same commit you
  tag for the npm release (step 7 above), so "what's live on
  timeline.knightlab.com" and "what's on npm" refer to the same code even
  though they reach users through different distribution channels.
