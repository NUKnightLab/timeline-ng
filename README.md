# timeline-ng

A modern rebuild of [Knight Lab TimelineJS](https://timeline.knightlab.com/) as a Svelte 5 monorepo. An experiment in vibe coding and the AT protocol.

For general information and our TimelineNG authoring tool, visit https://timeline.knightlab.com/ng/

## Requirements

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker (for the local ATProto devnet, you may not need this)

## Install

```sh
cd /path/to/timeline-ng
pnpm install
```

All commands below must be run from the repo root.

## Run

If you are working on the code and want to preview changes, the easiest way is probably 

```sh
pnpm dev
```

which should pick up all changes live.

### Authoring tool

If for some reason you don't want to use our public authoring tool, you can run it locally -- but this won't pick up changes to the player and core packages automatically.

```sh
pnpm authoring        # → http://127.0.0.1:5174
```

## Local ATProto devnet

When we started, we didn't want to save things to actual atmosphere accounts. There may be times in the future where we need to go back to off-network development while we try new things. We are grateful to the [atproto-devnet project](https://github.com/OpenMeet-Team/atproto-devnet) for providing a setup that helps us do this.

(if you're just working on incremental changes to the player or authoring tool, you probably don't need to worry about this. If you just want to have a throwaway place to save things, check out https://pds.rip/ )

To develop against a local PDS instead of Bluesky:

1. Install [mkcert](https://github.com/FiloSottile/mkcert) and run `mkcert -install` once.
2. Start the devnet:
   ```sh
   bash scripts/devnet-up.sh
   ```
3. Copy the devnet env file:
   ```sh
   cp packages/authoring/.env.devnet packages/authoring/.env.local
   ```
4. Run `pnpm authoring` and sign in with a devnet handle (e.g. `alice.devnet.test`).

## Build & test

```sh
pnpm build            # build all packages
pnpm test:run         # run all tests
pnpm typecheck        # type-check all packages
```

## Packages

| Package | Description |
|---|---|
| `packages/core` | Types, date parsing, validation, i18n, TL3 adapter |
| `packages/player` | Svelte components: SlidePlayer, TimeNav, MediaDisplay |
| `packages/authoring` | Standalone authoring SPA with ATProto persistence |
| `packages/embed` | Hosted iframe embed page (`?src=at://...` or `?src=https://...`) |
