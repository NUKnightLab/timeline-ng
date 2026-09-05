import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Without the `browser` condition, `svelte` resolves to its server build, where
// `$effect` is a deliberate no-op — effects silently never run and any test
// that depends on one passes or fails for the wrong reason.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    conditions: ['browser'],
    alias: {
      '@knight-lab/timeline-ng-core': `${root}../core/src/index.ts`,
      '@knight-lab/timeline-ng': `${root}../player/src/index.ts`,
    },
  },
});
