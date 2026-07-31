#!/usr/bin/env bun

/**
 * @file Durable gate for the authoritative canvas and widget-state runtime.
 */

import { resolve } from "node:path";

type TRegressionSuite = {
  readonly name: string;
  readonly cwd: string;
  readonly command: readonly string[];
};

const REPO_ROOT = resolve(import.meta.dir, "..");

const suites: readonly TRegressionSuite[] = [
  {
    name: "Cangine canvas document runtime",
    cwd: resolve(REPO_ROOT, "packages/canvas"),
    command: ["bun", "run", "test"],
  },
  {
    name: "widget frame and Capsule host runtime",
    cwd: resolve(REPO_ROOT, "packages/ui-ai-chat"),
    command: [
      "node",
      "./node_modules/vitest/vitest.mjs",
      "--run",
      "tests/widget-runtime",
      "tests/canvas-extension",
    ],
  },
  {
    name: "authoritative canvas service",
    cwd: resolve(REPO_ROOT, "packages/service-canvas"),
    command: ["bun", "test"],
  },
  {
    name: "centralized widget state service",
    cwd: resolve(REPO_ROOT, "packages/service-widget-state"),
    command: ["bun", "test"],
  },
];

async function runSuite(suite: TRegressionSuite): Promise<void> {
  console.log(`\n[canvas-regression] ${suite.name}`);
  const subprocess = Bun.spawn([...suite.command], {
    cwd: suite.cwd,
    env: {
      ...process.env,
      OMNIDRAW_SILENT_DB_MIGRATIONS: "1",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`${suite.name} failed with exit code ${exitCode}`);
  }
}

for (const suite of suites) {
  await runSuite(suite);
}

console.log(`\n[canvas-regression] passed ${suites.length} protected suites`);
