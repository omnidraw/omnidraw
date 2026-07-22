#!/usr/bin/env bun

/**
 * @file Durable M6 gate for typed, bounded, scale-to-zero server functions.
 */

import { resolve } from 'node:path';

type TFunctionRuntimeSuite = Readonly<{
  name: string;
  command: readonly string[];
  requiredPaths: readonly string[];
}>;

const REPO_ROOT = resolve(import.meta.dir, '..');

const suites: readonly TFunctionRuntimeSuite[] = [
  {
    name: 'SDK build inputs for a clean focused gate',
    command: ['bun', 'run', '--cwd', 'packages/sdk', 'build'],
    requiredPaths: [
      'packages/sdk/package.json',
      'packages/sdk/scripts/build.ts',
      'packages/sdk/src/server.ts',
      'packages/sdk/src/function-client.ts',
    ],
  },
  {
    name: 'public contracts, schema bounds, sandbox lifecycle, and spoof resistance',
    command: ['bun', 'test', 'packages/function-runtime/tests', '--timeout=30000'],
    requiredPaths: [
      'packages/function-runtime/tests/function-runtime.test.ts',
      'packages/function-runtime/tests/local-runtime.test.ts',
    ],
  },
  {
    name: 'durable definitions, idempotency, leases, cancellation, recovery, usage, and retention',
    command: [
      'bun',
      'test',
      'packages/service-db/src/tests/FunctionControlStoreTurso.test.ts',
      'packages/service-db/src/tests/WidgetControlStoreTurso.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/service-db/src/tests/FunctionControlStoreTurso.test.ts',
      'packages/service-db/src/tests/fixtures/function-control-claim-crash.ts',
      'packages/service-db/src/tests/WidgetControlStoreTurso.test.ts',
    ],
  },
  {
    name: 'atomic KV, secret, and database operation receipts',
    command: [
      'bun',
      'test',
      'packages/resource-runtime/tests/function-operation-receipts.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: ['packages/resource-runtime/tests/function-operation-receipts.test.ts'],
  },
  {
    name: 'SDK descriptors, generated proxy types, immutable publication, and API composition',
    command: [
      'bun',
      'test',
      'packages/sdk/tests/server-functions.test.ts',
      'packages/widget-contract/tests/widget-contract.test.ts',
      'packages/widget-contract/tests/local-artifacts.test.ts',
      'packages/api/src/function/contract.test.ts',
      'packages/api/src/context-composition.test.ts',
      'packages/api/src/route-equivalence.test.ts',
      'apps/cli/tests/FunctionService.test.ts',
      'apps/cli/tests/FunctionRuntimeComposition.test.ts',
      'apps/cli/tests/WidgetService.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/sdk/tests/server-functions.test.ts',
      'packages/sdk/tests/generated-proxy-types.fixture.ts',
      'packages/widget-contract/tests/widget-contract.test.ts',
      'packages/widget-contract/tests/local-artifacts.test.ts',
      'packages/api/src/function/contract.test.ts',
      'apps/cli/tests/FunctionService.test.ts',
      'apps/cli/tests/FunctionRuntimeComposition.test.ts',
      'apps/cli/tests/WidgetService.test.ts',
    ],
  },
  {
    name: 'function proxy and production composition type contracts',
    command: ['bunx', 'tsc', '-p', 'packages/sdk/tsconfig.type-tests.json', '--noEmit'],
    requiredPaths: ['packages/sdk/tsconfig.type-tests.json'],
  },
  {
    name: 'runtime dependency, guest-authority, and scale-to-zero boundaries',
    command: ['bun', 'test', 'scripts/function-runtime-boundary.test.ts'],
    requiredPaths: ['scripts/function-runtime-boundary.test.ts'],
  },
];

async function assertSuiteExists(suite: TFunctionRuntimeSuite): Promise<void> {
  for (const path of suite.requiredPaths) {
    const file = Bun.file(resolve(REPO_ROOT, path));
    if (!(await file.exists())) {
      throw new Error(`[function-runtime] required input is missing for "${suite.name}": ${path}`);
    }
    if (
      path.endsWith('.test.ts')
      && /\b(?:describe|it|test)\.(?:skip|todo)\s*\(/.test(await file.text())
    ) {
      throw new Error(`[function-runtime] skipped or unfinished assertion: ${path}`);
    }
  }
}

async function runSuite(suite: TFunctionRuntimeSuite, index: number): Promise<void> {
  await assertSuiteExists(suite);
  console.log(`\n[function-runtime ${index + 1}/${suites.length}] ${suite.name}`);
  console.log(`[function-runtime] $ ${suite.command.join(' ')}`);
  const subprocess = Bun.spawn([...suite.command], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VIBECANVAS_SILENT_DB_MIGRATIONS: '1',
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(
      `[function-runtime ${index + 1}/${suites.length}] "${suite.name}" failed with exit code ${exitCode}`,
    );
  }
}

for (const [index, suite] of suites.entries()) await runSuite(suite, index);

console.log(`\n[function-runtime] passed all ${suites.length} bounded execution suites`);
