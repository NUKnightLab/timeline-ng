# example-svelte5-json

Renders `SlidePlayer` with timeline data imported directly from a static
`timeline.json` file bundled alongside the app.

This is the pattern to follow if you've exported JSON from the editor's
**Publish → Download JSON** and want to host it alongside your site — see the
[self-hosting guide](https://timeline.knightlab.com/ng/docs.html#self-hosting) for
the full walkthrough.

## Run

```sh
pnpm install
pnpm --filter @timeline-ng/example-svelte5-json dev
```
