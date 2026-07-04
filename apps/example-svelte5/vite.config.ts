import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@knight-lab/timeline-ng-core': `${root}../../packages/core/src/index.ts`,
      '@knight-lab/timeline-ng/styles.css': `${root}../../packages/player/src/styles/base.css`,
      '@knight-lab/timeline-ng': `${root}../../packages/player/src/index.ts`,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5300,
  },
});
