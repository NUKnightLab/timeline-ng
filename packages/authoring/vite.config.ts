import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@knight-lab/timeline-ng-core': `${root}../core/src/index.ts`,
      '@knight-lab/timeline-ng': `${root}../player/src/index.ts`,
    },
  },
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
