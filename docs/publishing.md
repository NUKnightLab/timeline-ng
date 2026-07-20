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

**Core must be published before player, every time both have changes.**

Player's `package.json` depends on core via `"workspace:*"`. When you run
`pnpm publish` inside `packages/player`, pnpm rewrites that to the *exact*
version string from core's local `package.json` at that moment (not a
range — `workspace:*` becomes e.g. `"0.2.0"`, not `"^0.2.0"`). If core 0.2.0
isn't live on the npm registry yet, anyone who `npm install`s the newly
published player will get a dependency resolution failure, because nothing
satisfies an exact pin to a version that doesn't exist.

So the sequence is:

1. Finish and commit all changes for the release (see [Release checklist](#release-checklist)).
2. Bump and publish **core** first.
3. Verify core's new version is live on the registry (`npm view @knight-lab/timeline-ng-core version`
   should show the new version — allow a minute or two for propagation).
4. Bump and publish **player**.
5. Tag the release in git and push.

If only core changed (no player-visible changes), you can publish core alone
and skip player — but if you bump player's version to a new release for any
reason while core also has unpublished changes, core must go out first.

Because the pin is exact, a future *patch* release of core alone (say
0.2.1) does **not** automatically reach anyone who installed player 0.2.0 —
they're still pinned to core 0.2.0. If you want consumers to pick up core
patches without a player republish, change player's dependency to
`"workspace:^"` (→ published as `"^0.2.0"`) instead of `"workspace:*"`. That's
a deliberate tradeoff to make consciously, not part of routine publishing.

## Release checklist

1. **Make sure everything intended for the release is committed.** Check
   `git status` and `git diff` — don't publish with unrelated uncommitted
   work sitting in the tree.
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
5. **Run the full check before publishing anything:**
   ```sh
   pnpm --filter @knight-lab/timeline-ng-core test:run
   pnpm --filter @knight-lab/timeline-ng-core typecheck
   pnpm --filter @knight-lab/timeline-ng-core build

   pnpm --filter @knight-lab/timeline-ng typecheck
   pnpm --filter @knight-lab/timeline-ng build
   ```
6. **Commit** the changelog + version bumps (and any remaining feature work)
   with a normal commit — this repo doesn't use a separate "release commit"
   convention beyond that.
7. **Publish core:**
   ```sh
   cd packages/core
   npm publish
   ```
   (`npm publish` respects the `publishConfig.access: "public"` and
   `files` fields already set in `package.json`; `pnpm publish` also
   works and additionally validates the workspace dependency rewrite.)

   **Must be run interactively, in a real terminal, by whoever owns the
   npmjs.com account.** The registry requires a one-time-password/browser
   approval per publish (`EOTP`), and npm deliberately redacts the
   approval URL from all output and logs — there's no way to complete
   this non-interactively or on someone else's behalf.
8. **Verify core is live:**
   ```sh
   npm view @knight-lab/timeline-ng-core version
   ```
9. **Publish player:**
   ```sh
   cd packages/player
   npm publish
   ```
10. **Tag and push:**
    ```sh
    git tag v<version>   # repo convention so far: one tag shared across
                          # a release even though packages version
                          # independently — see existing v0.1.0 tag
    git push origin main --tags
    ```

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
  tag for the npm release (step 10 above), so "what's live on
  timeline.knightlab.com" and "what's on npm" refer to the same code even
  though they reach users through different distribution channels.
