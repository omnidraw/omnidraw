import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from "node:path";

const frontendPort = Number.parseInt(process.env.VIBECANVAS_FRONTEND_PORT ?? "3002", 10);
const backendPort = Number.parseInt(process.env.VIBECANVAS_BACKEND_PORT ?? "3000", 10);
const backendHost = process.env.VIBECANVAS_BACKEND_HOST ?? "localhost";
const backendTarget = `http://${backendHost}:${backendPort}`;

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    devtools(),
    solidPlugin()
  ],
  server: {
    port: frontendPort,
    proxy: {
      '/api': {
        target: backendTarget,
        ws: true
      },
      '/files': {
        target: backendTarget
      },
      '/automerge': {
        target: backendTarget,
        ws: true
      }
    }
  },
  build: {
    target: 'esnext',
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src")
    }
  },
  optimizeDeps: {
    exclude: [
      'lucide-solid',
    ],
    // Include Automerge packages for proper CJS/ESM interop
    include: [
      '@vibecanvas/canvas > @arrow-js/sandbox',
      '@automerge/automerge',
      '@automerge/automerge-repo',
      '@automerge/automerge-repo-network-websocket',
      '@automerge/automerge-repo-network-broadcastchannel',
      '@automerge/automerge-repo-storage-indexeddb'
    ]
  }
});
