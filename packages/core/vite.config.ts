import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// `pnpm dev` runs this as `vite build --watch`. Nothing in dev reads dist/ —
// every app aliases this package to src/ — so declarations are pure cost there,
// and clearing dist/ between rebuilds actively breaks workers/og-preview, which
// resolves us through package.json exports rather than an alias.
const watching = process.argv.includes('--watch') || process.argv.includes('-w');

export default defineConfig({
  plugins: [
    // This is the only thing that emits declarations for this package; the
    // `tsc -p tsconfig.build.json` step the build script used to run was a
    // silent no-op, because tsconfig.base.json's `noEmit` overrode its
    // `emitDeclarationOnly`. Tests need excluding here or they ship.
    ...(watching ? [] : [dts({
      include: ['src'],
      exclude: ['src/**/*.test.ts'],
      insertTypesEntry: true,
    })]),
  ],
  build: {
    emptyOutDir: !watching,
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['dompurify'],
    },
  },
});
