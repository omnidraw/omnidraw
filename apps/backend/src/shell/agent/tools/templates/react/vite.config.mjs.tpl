import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const manifest = JSON.parse(readFileSync(new URL("./.omnidraw/build-manifest.json", import.meta.url), "utf8"));

export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: 'hidden',
    minify: false,
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: manifest.ui.entry,
      external: ["capsule:bridge"],
      output: {
        format: "es",
        entryFileNames: "main.js",
        chunkFileNames: "chunks/[name]-[hash].mjs",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
