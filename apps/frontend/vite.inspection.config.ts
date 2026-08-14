import { resolve } from "node:path";
import solidPlugin from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vite";

/**
 * The inspection shell is served below a one-time URL token. Keep its entry
 * and assets in one private root and make every browser request token-relative.
 */
export default defineConfig({
  root: resolve(__dirname, "inspection"),
  base: "./",
  plugins: [wasm(), solidPlugin()],
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, "dist/inspection"),
    target: "esnext",
    rollupOptions: {
      input: resolve(__dirname, "inspection/index.html"),
    },
  },
  resolve: {
    alias: [
      { find: /^@omnidraw\/sdk$/, replacement: resolve(__dirname, "../../packages/sdk/src/index.ts") },
      { find: /^@omnidraw\/sdk\/host$/, replacement: resolve(__dirname, "../../packages/sdk/src/host.ts") },
    ],
  },
  optimizeDeps: {
    exclude: ["lucide-static"],
  },
});
