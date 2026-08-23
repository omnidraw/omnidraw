import { resolve } from "node:path";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vite";

const externalPackage = /^(?:@omnidraw\/canvas|@solidjs\/web|dompurify|effect|lucide-static|prosemirror-|solid-js)(?:\/|$)/;

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [solid({ solid: { moduleName: "@solidjs/web" } })],
  build: {
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    emptyOutDir: mode !== "dev-watch",
    target: "esnext",
    sourcemap: false,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        index: resolve(__dirname, "src/index.ts"),
        "canvas-frame": resolve(__dirname, "src/canvas-frame.ts"),
        styles: resolve(__dirname, "src/styles.css"),
      },
      external: (id) => externalPackage.test(id),
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (asset) => asset.name?.endsWith(".css")
          ? "styles.css"
          : "assets/[name]-[hash][extname]",
      },
    },
  },
}));
