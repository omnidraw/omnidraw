import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/screenshot",
  outputDir: "./test-results/playwright",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4512",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:4512",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
});
