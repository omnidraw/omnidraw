import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: [
      {
        find: "src",
        replacement: resolve(__dirname, "src"),
      },
      {
        find: /^@vibecanvas\/canvas-contract$/,
        replacement: resolve(__dirname, "../canvas-contract/src/index.ts"),
      },
      {
        find: /^@vibecanvas\/canvas-contract\/CONSTANTS$/,
        replacement: resolve(__dirname, "../canvas-contract/src/CONSTANTS.ts"),
      },
      {
        find: /^@vibecanvas\/tenant-core\/fn\.scoped-key$/,
        replacement: resolve(
          __dirname,
          "../tenant-core/src/core/fn.scoped-key.ts",
        ),
      },
      {
        find: /^@omnidraw\/cangine\/testing$/,
        replacement: resolve(
          __dirname,
          "../canvas-contract/node_modules/@omnidraw/cangine/dist/testing/index.js",
        ),
      },
    ],
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
});
