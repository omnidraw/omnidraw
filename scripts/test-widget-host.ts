#!/usr/bin/env bun

/**
 * @file Durable gate for canvas widget identity, state, and Capsule hosting.
 */

import { resolve } from "node:path"

type TWidgetSuite = Readonly<{
  name: string
  command: readonly string[]
  cwd?: string
}>

const REPO_ROOT = resolve(import.meta.dir, "..")
const suites: readonly TWidgetSuite[] = [
  {
    name: "canvas item and widget identity persistence",
    command: ["bun", "test",
      "packages/canvas-contract/tests/canvas-contract.test.ts",
      "packages/service-db/src/tests/CanvasItemStoreTurso.test.ts",
    ],
  },
  {
    name: "authoritative canvas and centralized widget state",
    command: ["bun", "test",
      "packages/service-canvas/tests/CanvasService.test.ts",
      "packages/service-widget-state/src/WidgetStateService.test.ts",
    ],
  },
  {
    name: "exact widget runtime authority",
    command: ["bun", "test",
      "packages/widget-contract/tests/browser-ui-artifact.test.ts",
      "packages/api/src/context-composition.test.ts",
      "packages/api/src/route-equivalence.test.ts",
      "apps/cli/tests/WidgetRuntimeLoadAdmission.test.ts",
      "apps/cli/tests/FunctionRuntimeComposition.test.ts",
      "--timeout=30000",
    ],
  },
  {
    name: "Capsule host bridge and bounded UI runtime",
    cwd: resolve(REPO_ROOT, "packages/ui-ai-chat"),
    command: ["bun", "run", "test", "--",
      "tests/widget-runtime/WidgetUiRuntime.test.ts",
      "tests/widget-runtime/fn.capsule-population.test.ts",
      "tests/widget-runtime/create-widget-collaborative-state-port.test.ts",
      "tests/widget-runtime/create-widget-function-host-bridge.test.ts",
      "tests/widget-runtime/mount-widget-ui-artifact.test.ts",
    ],
  },
]

for (const suite of suites) {
  console.log(`\n[widget-host] ${suite.name}`)
  const subprocess = Bun.spawn([...suite.command], {
    cwd: suite.cwd ?? REPO_ROOT,
    env: {
      ...process.env,
      OMNIDRAW_SILENT_DB_MIGRATIONS: "1",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await subprocess.exited
  if (exitCode !== 0) throw new Error(`${suite.name} failed with exit code ${exitCode}`)
}

console.log(`\n[widget-host] passed ${suites.length} authority suites`)
