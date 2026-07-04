# @knight-lab/timeline-ng

Svelte 5 components for rendering [TimelineJS](https://timeline.knightlab.com/)-style interactive timelines: `SlidePlayer`, `TimeNav`, `SlideContent`, and a JSON loader. 

## Install

```sh
npm install @knight-lab/timeline-ng
```

`svelte@^5.0.0` is a peer dependency.

## Usage

```svelte
<script lang="ts">
  import { SlidePlayer, loadTimeline } from '@knight-lab/timeline-ng';
  import '@knight-lab/timeline-ng/styles.css';

  const result = await loadTimeline('/path/to/timeline.json');
</script>

{#if result.ok}
  <SlidePlayer timeline={result.timeline} />
{/if}
```

`SlidePlayer` accepts `language`, `theme` (`"light" | "dark" | "auto"`), `initialIndex`,
and `reverseOrder` props.

## Styling

The player exposes CSS custom properties for theming. Set them on the container or any
ancestor element:

```css
#my-timeline {
  --tl-color-accent: #0066cc;
  --tl-font-heading: 'Georgia', serif;
  --tl-stage-min-height: 300px;
}
```

**Note:** more user control over timeline styling is a priority for this project, but it hasn't been tested very m uch. We have a high priority on making things easy for users of our authoring tool, so some of this could change if needed to facilitate that. Proceed with caution until we hit a 1.0.0 release.

## Timeline data

Timeline JSON follows the format defined by
[`@knight-lab/timeline-ng-core`](https://npmx.dev/package/@knight-lab/timeline-ng-core),
which ships a [JSON Schema](https://npmx.dev/package/@knight-lab/timeline-ng-core) for the
format alongside TypeScript types, and provides a `fromTL3` adapter for migrating existing
TimelineJS 3 data. You can use our authoring tool at https://timeline.knightlab.com/ng/ and export JSON. The authoring tool also provides a hosted publishing option if you log in with an atmosphere account to save your configuration.

## Links

- [Timeline data format guide](https://timeline.knightlab.com/ng/docs.html#data-format)
- [Full documentation and self-hosting guide](https://github.com/NUKnightLab/timeline-ng)
- [Report an issue](https://github.com/NUKnightLab/timeline-ng/issues)
