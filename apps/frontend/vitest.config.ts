import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid({ solid: { moduleName: "@solidjs/web" } })],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
    testTimeout: 20_000,
  },
});
