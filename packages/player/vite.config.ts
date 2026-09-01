import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// `pnpm dev` runs this as `vite build --watch`. Nothing in dev reads dist/*.d.ts
// — every app aliases this package to src/ — and rollupTypes (api-extractor)
// intermittently fails on incremental rebuilds, so only emit types for a real build.
const watching = process.argv.includes('--watch') || process.argv.includes('-w');

export default defineConfig({
  resolve: {
    alias: {
      // Point directly at core source so Storybook/dev don't need a prior build
      '@knight-lab/timeline-ng-core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  plugins: [
    svelte(),
    ...(watching ? [] : [dts({
      include: ['src'],
      insertTypesEntry: true,
      rollupTypes: true,
      beforeWriteFile: (filePath, content) => ({
        filePath,
        content: content.replace(
          /from ['"][^'"]*\/core\/src\/index(?:\.ts)?['"]/g,
          `from '@knight-lab/timeline-ng-core'`
        ),
      }),
    })]),
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: 'index',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: ['svelte', 'svelte/internal', '@knight-lab/timeline-ng-core', 'dompurify'],
    },
    cssCodeSplit: false,
  },
});
