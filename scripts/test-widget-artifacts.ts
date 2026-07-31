#!/usr/bin/env bun

/**
 * @file Durable M5 gate for immutable widget artifacts.
 */

import { resolve } from 'node:path';

type TWidgetArtifactSuite = Readonly<{
  name: string;
  command: readonly string[];
  requiredPaths: readonly string[];
}>;

const REPO_ROOT = resolve(import.meta.dir, '..');
const CLI_INTEGRATION_TEST = 'apps/cli/tests/WidgetService.test.ts';

const suites: TWidgetArtifactSuite[] = [
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
    name: 'Capsule widget v3 contracts, immutable builds, capabilities, and garbage collection',
    command: ['bun', 'test', 'packages/widget-contract/tests', '--timeout=30000'],
    requiredPaths: [
      'packages/widget-contract/tests/widget-contract-v3.test.ts',
      'packages/widget-contract/tests/browser-ui-artifact.test.ts',
      'packages/widget-contract/tests/widget-artifact-recovery.test.ts',
      'packages/widget-contract/tests/widget-preview.test.ts',
      'packages/widget-contract/tests/fixtures/widget-artifact-orphan-writer.ts',
    ],
  },
  {
    name: 'transactional widget definitions, revisions, bindings, rollback, and retention',
    command: [
      'bun',
      'test',
      'packages/service-db/src/tests/WidgetControlStoreTurso.test.ts',
    ],
    requiredPaths: [
      'packages/service-db/src/tests/WidgetControlStoreTurso.test.ts',
    ],
  },
  {
    name: 'production widget publication composition and immutable persistence',
    command: ['bun', 'test', CLI_INTEGRATION_TEST, '--timeout=30000'],
    requiredPaths: [CLI_INTEGRATION_TEST],
  },
  {
    name: 'browser safety, capability, and artifact-path boundaries',
    command: ['bun', 'test', 'scripts/widget-artifact-boundary.test.ts'],
    requiredPaths: ['scripts/widget-artifact-boundary.test.ts'],
  },
];

async function assertSuiteExists(suite: TWidgetArtifactSuite): Promise<void> {
  for (const path of suite.requiredPaths) {
    const file = Bun.file(resolve(REPO_ROOT, path));
    if (!(await file.exists())) {
      throw new Error(
        `[widget-artifacts] required input is missing for "${suite.name}": ${path}`,
      );
    }
    if (/\b(?:describe|it|test)\.(?:skip|todo)\s*\(/.test(await file.text())) {
      throw new Error(
        `[widget-artifacts] skipped or unfinished assertions are forbidden in required suite: ${path}`,
      );
    }
  }
}

async function runSuite(suite: TWidgetArtifactSuite, index: number): Promise<void> {
  await assertSuiteExists(suite);
  console.log(`\n[widget-artifacts ${index + 1}/${suites.length}] ${suite.name}`);
  console.log(`[widget-artifacts] $ ${suite.command.join(' ')}`);

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
      `[widget-artifacts ${index + 1}/${suites.length}] "${suite.name}" failed with exit code ${exitCode}`,
    );
  }
}

for (const [index, suite] of suites.entries()) await runSuite(suite, index);

console.log(`\n[widget-artifacts] passed all ${suites.length} immutable artifact suites`);
