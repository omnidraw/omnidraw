import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
    ],
    testTimeout: 20_000,
  },
});
