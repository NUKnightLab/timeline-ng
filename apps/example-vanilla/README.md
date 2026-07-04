# example-vanilla

Mounts `SlidePlayer` directly with Svelte's `mount()` API and a plain, hand-written
`TLTimeline` object — no ATProto, no fetch, no Svelte component authoring required.

This is the pattern to follow if you're generating timeline data yourself (from a
database, CMS, or spreadsheet) and just want to render it with the minimum amount
of code.

## Run

```sh
pnpm install
pnpm --filter @timeline-ng/example-vanilla dev
```
