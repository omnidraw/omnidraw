#!/usr/bin/env bun

/**
 * @file Durable gate for renderer, widget hosting, and collaboration behavior.
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
    name: "canvas interactions and deterministic CRDT state",
    cwd: resolve(REPO_ROOT, "packages/canvas"),
    command: ["bun", "run", "test"],
  },
  {
    name: "widget frame, portal, fullscreen, placement, clone, and draft Preview",
    cwd: resolve(REPO_ROOT, "packages/ui-ai-chat"),
    command: [
      "node",
      "./node_modules/vitest/vitest.mjs",
      "--run",
      "tests/widget",
      "tests/widget-placement",
      "tests/draft-preview",
    ],
  },
  {
    name: "Automerge service and reconnect adapter compatibility",
    cwd: resolve(REPO_ROOT, "packages/service-automerge"),
    command: [
      "bun",
      "test",
      "tests/AutomergeService.test.ts",
      "tests/websocket.adapter.test.ts",
    ],
  },
];

async function runSuite(suite: TRegressionSuite): Promise<void> {
  console.log(`\n[canvas-regression] ${suite.name}`);
  const subprocess = Bun.spawn([...suite.command], {
    cwd: suite.cwd,
    env: {
      ...process.env,
      VIBECANVAS_SILENT_AUTOMERGE_LOGS: "1",
      VIBECANVAS_SILENT_DB_MIGRATIONS: "1",
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
