# example-custom-theme

Skins `SlidePlayer` with a fully custom "Ink & Type" newspaper theme, built
entirely from the player's `--tl-*` design tokens (see
[`theme.css`](src/theme.css)) — no component overrides required.

Also switches between an English and a Spanish `timeline.json`, passing the
matching `language` prop so the player's own UI chrome (buttons, labels,
date formatting) is translated.

**Note:** content (headline, text, captions, media) is not automatically translated. Serving content in multiple languages requires multiple JSON configuration files. (see [src/timelines/en.json](src/timelines/en.json) and [src/timelines/es.json](src/timelines/es.json)). 

This is the pattern to follow if you want the player to match your site's
branding, or if you're publishing a timeline in more than one language.

## Run

```sh
pnpm install
pnpm --filter @timeline-ng/example-custom-theme dev
```
