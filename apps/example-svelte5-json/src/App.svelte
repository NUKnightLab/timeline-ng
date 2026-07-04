<script lang="ts">
  import { SlidePlayer } from '@knight-lab/timeline-ng';
  import '@knight-lab/timeline-ng/styles.css';
  import type { TLTimeline } from '@knight-lab/timeline-ng-core';
  import timelineData from './timeline.json';

  const timeline = timelineData as TLTimeline;
</script>

<SlidePlayer {timeline} />

<style>
  :global(html, body, #app) {
    margin: 0;
    padding: 0;
    height: 100%;
  }
</style>
