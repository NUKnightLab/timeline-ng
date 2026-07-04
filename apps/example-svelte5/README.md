# example-svelte5

Loads a timeline from an AT URI (or a `?src=` query parameter override) using
`loadTimeline()` and renders it with `SlidePlayer` inside a Svelte 5 component, showing loading and error states while the fetch is in flight.

This is the pattern to follow if your timeline data lives on a PDS or any URL you
want to fetch at runtime.

## Run

```sh
pnpm install
pnpm --filter @timeline-ng/example-svelte5 dev
```
