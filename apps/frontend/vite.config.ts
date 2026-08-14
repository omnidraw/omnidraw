import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from "node:path";
import { BUILTIN_THEMES } from "../../packages/theme/src/builtins";
import { fnThemeCssRule } from "../../packages/theme/src/dom";

const frontendPort = Number.parseInt(process.env.OMNIDRAW_FRONTEND_PORT ?? "3002", 10);
const backendPort = Number.parseInt(process.env.OMNIDRAW_BACKEND_PORT ?? "3000", 10);
const backendHost = process.env.OMNIDRAW_BACKEND_HOST ?? "localhost";
const backendTarget = `http://${backendHost}:${backendPort}`;
const sourceThemeCss = `/* Source-run theme defaults; release builds generate the same rule. */\n${fnThemeCssRule(BUILTIN_THEMES[0])}`;

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    {
      name: 'omnidraw-source-theme-css',
      enforce: 'pre',
      resolveId(id) {
        return id === '@omnidraw/theme/default.css' || id === '@omnidraw/theme/canvas.css'
          ? `\0omnidraw-source-theme-css:${id}`
          : null;
      },
      load(id) {
        return id.startsWith('\0omnidraw-source-theme-css:') ? sourceThemeCss : null;
      },
    },
    devtools(),
    solidPlugin()
  ],
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    proxy: {
      '/rpc': {
        target: backendTarget,
        ws: true
      },
      '/health': {
        target: backendTarget
      },
      '/files': {
        target: backendTarget
      },
    }
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        app: resolve(__dirname, './index.html'),
        inspection: resolve(__dirname, './inspection.html'),
      },
    },
  },
  resolve: {
    // Private source-run applications resolve only supported public entrypoints
    // to source. Packed consumers continue exercising package exports from dist.
    alias: [
      { find: /^@omnidraw\/canvas$/, replacement: resolve(__dirname, '../../packages/canvas/src/index.ts') },
      { find: /^@omnidraw\/canvas\/styles\.css$/, replacement: resolve(__dirname, '../../packages/canvas/src/styles.css') },
      { find: /^@omnidraw\/canvas-contract$/, replacement: resolve(__dirname, '../../packages/canvas-contract/src/index.ts') },
      { find: /^@omnidraw\/component-ai-chat$/, replacement: resolve(__dirname, '../../packages/component-ai-chat/src/index.ts') },
      { find: /^@omnidraw\/component-ai-chat\/styles\.css$/, replacement: resolve(__dirname, '../../packages/component-ai-chat/src/styles.css') },
      { find: /^@omnidraw\/sdk$/, replacement: resolve(__dirname, '../../packages/sdk/src/index.ts') },
      { find: /^@omnidraw\/sdk\/host$/, replacement: resolve(__dirname, '../../packages/sdk/src/host.ts') },
      { find: /^@omnidraw\/theme$/, replacement: resolve(__dirname, '../../packages/theme/src/index.ts') },
      { find: '@', replacement: resolve(__dirname, './src') },
    ],
  },
  optimizeDeps: {
    exclude: [
      'lucide-solid',
    ]
  }
});
