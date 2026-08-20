import { resolve } from 'node:path';
import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';

const externalPackage = /^(?:@omnidraw\/cangine|@omnidraw\/canvas-contract|@omnidraw\/theme|@solidjs\/web|effect|solid-js)(?:\/|$)/;

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [solid({ solid: { moduleName: '@solidjs/web' } })],
  build: {
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    emptyOutDir: mode !== 'kernel-watch',
    target: 'esnext',
    sourcemap: false,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        index: resolve(__dirname, 'src/index.ts'),
        'debug-trace/index': resolve(__dirname, 'src/debug-trace/index.ts'),
        extension: resolve(__dirname, 'src/extension.ts'),
        styles: resolve(__dirname, 'src/styles.css'),
        types: resolve(__dirname, 'src/types.ts'),
      },
      external: (id) => externalPackage.test(id),
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => (
          asset.name?.endsWith('.css') === true
            ? 'styles.css'
            : 'assets/[name]-[hash][extname]'
        ),
      },
    },
  },
}));
