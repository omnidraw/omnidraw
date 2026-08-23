import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid({ solid: { moduleName: "@solidjs/web" } })],
  resolve: {
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
  },
});
