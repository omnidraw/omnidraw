import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from "node:path";
import { gzipSync } from 'node:zlib';
import type { OutputBundle, OutputChunk } from 'rollup';
import { BUILTIN_THEMES } from "../../packages/theme/src/builtins";
import { fnThemeCssRule } from "../../packages/theme/src/dom";

const frontendPort = Number.parseInt(process.env.OMNIDRAW_FRONTEND_PORT ?? "3002", 10);
const backendPort = Number.parseInt(process.env.OMNIDRAW_BACKEND_PORT ?? "3000", 10);
const backendHost = process.env.OMNIDRAW_BACKEND_HOST ?? "localhost";
const backendTarget = `http://${backendHost}:${backendPort}`;
const sourceThemeCss = `/* Source-run theme defaults; release builds generate the same rule. */\n${fnThemeCssRule(BUILTIN_THEMES[0])}`;
const CANVAS_CRITICAL_GZIP_BUDGET = 460 * 1024;

function canvasCriticalGraphGate() {
  return {
    name: 'omnidraw-canvas-critical-graph',
    generateBundle(_options: unknown, bundle: OutputBundle) {
      const chunks = Object.values(bundle).filter(
        (entry): entry is OutputChunk => entry.type === 'chunk',
      );
      const canvasRoute = chunks.find((chunk) => Object.keys(chunk.modules).some(
        (moduleId) => moduleId.replaceAll('\\', '/').endsWith(
          '/apps/frontend/src/shell/framework/pages/canvas.tsx',
        ),
      ));
      if (canvasRoute === undefined) {
        this.error('Canvas critical graph gate could not find the Canvas route chunk.');
        return;
      }
      const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const critical = new Map<string, OutputChunk>();
      const visit = (chunk: OutputChunk): void => {
        if (critical.has(chunk.fileName)) return;
        critical.set(chunk.fileName, chunk);
        for (const imported of chunk.imports) {
          const dependency = byFileName.get(imported);
          if (dependency !== undefined) visit(dependency);
        }
      };
      visit(canvasRoute);

      const violations: string[] = [];
      for (const chunk of critical.values()) {
        for (const rawModuleId of Object.keys(chunk.modules)) {
          const moduleId = rawModuleId.replaceAll('\\', '/');
          const forbidden = (
            moduleId.includes('/packages/sdk/src/')
            || moduleId.includes('@omnidraw+capsule')
            || (
              moduleId.includes('/packages/component-ai-chat/src/')
              && !moduleId.endsWith('/canvas-frame.ts')
            )
            || /\/FontkitTextShaper\.(?:js|ts)$/.test(moduleId)
            || moduleId.includes('emscripten-module')
            || /\/node_modules\/(?:\.bun\/)?three(?:@|\/)/.test(moduleId)
          );
          if (forbidden) violations.push(moduleId);
        }
      }
      if (violations.length > 0) {
        this.error([
          'Canvas interaction-critical graph contains optional implementations:',
          ...violations.map((moduleId) => `- ${moduleId}`),
        ].join('\n'));
        return;
      }
      const gzipBytes = [...critical.values()].reduce(
        (total, chunk) => total + gzipSync(chunk.code).byteLength,
        0,
      );
      if (gzipBytes > CANVAS_CRITICAL_GZIP_BUDGET) {
        this.error(
          `Canvas critical graph is ${gzipBytes} gzip bytes; budget is ${CANVAS_CRITICAL_GZIP_BUDGET}.`,
        );
        return;
      }
      this.info(
        `Canvas critical graph: ${critical.size} chunks, ${gzipBytes} gzip bytes (budget ${CANVAS_CRITICAL_GZIP_BUDGET}).`,
      );
    },
  };
}

export default defineConfig({
  plugins: [
    wasm(),
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
    solidPlugin(),
    canvasCriticalGraphGate(),
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
      { find: /^@omnidraw\/component-ai-chat\/canvas-frame$/, replacement: resolve(__dirname, '../../packages/component-ai-chat/src/canvas-frame.ts') },
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
