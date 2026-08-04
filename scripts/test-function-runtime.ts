#!/usr/bin/env bun

/**
 * @file Focused gate for typed, bounded, short-lived server functions.
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
    name: 'direct executor, schema bounds, cancellation, concurrency, and ephemeral permits',
    command: [
      'bun',
      'test',
      'packages/function-runtime/tests/direct-function-runtime.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/function-runtime/tests/direct-function-runtime.test.ts',
    ],
  },
  {
    name: 'filesystem-backed production invocation and no retained history',
    command: [
      'bun',
      'test',
      'apps/cli/tests/FunctionService.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'apps/cli/tests/FunctionService.test.ts',
    ],
  },
  {
    name: 'browser SDK bridge invokes one direct current-catalog request',
    command: [
      'bun',
      'run',
      '--cwd',
      'packages/ui-ai-chat',
      'test',
      '--',
      'tests/widget-runtime/create-widget-function-host-bridge.test.ts',
    ],
    requiredPaths: [
      'packages/ui-ai-chat/tests/widget-runtime/create-widget-function-host-bridge.test.ts',
    ],
  },
  {
    name: 'SDK descriptors, generated proxy types, and direct invoke API composition',
    command: [
      'bun',
      'test',
      'packages/sdk/tests/server-functions.test.ts',
      'packages/widget-contract/tests/widget-contract-v4.test.ts',
      'packages/widget-contract/tests/widget-release-v1.test.ts',
      'packages/api/src/function/contract.test.ts',
      'apps/cli/tests/FunctionService.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/sdk/tests/server-functions.test.ts',
      'packages/sdk/tests/generated-proxy-types.fixture.ts',
      'packages/widget-contract/tests/widget-contract-v4.test.ts',
      'packages/widget-contract/tests/widget-release-v1.test.ts',
      'packages/api/src/function/contract.test.ts',
      'apps/cli/tests/FunctionService.test.ts',
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
      OMNIDRAW_SILENT_DB_MIGRATIONS: '1',
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

console.log(`\n[function-runtime] passed all ${suites.length} direct execution suites`);
