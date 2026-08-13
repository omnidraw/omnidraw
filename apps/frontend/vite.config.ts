import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import devtools from 'solid-devtools/vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from "node:path";

const frontendPort = Number.parseInt(process.env.OMNIDRAW_FRONTEND_PORT ?? "3002", 10);
const backendPort = Number.parseInt(process.env.OMNIDRAW_BACKEND_PORT ?? "3000", 10);
const backendHost = process.env.OMNIDRAW_BACKEND_HOST ?? "localhost";
const backendTarget = `http://${backendHost}:${backendPort}`;

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
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
    alias: {
      "@": resolve(__dirname, "./src")
    }
  },
  optimizeDeps: {
    exclude: [
      'lucide-solid',
    ]
  }
});
