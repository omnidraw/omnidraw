#!/usr/bin/env bun

/**
 * @file Focused gate for filesystem publications and runtime loading.
 */

import { resolve } from 'node:path';

type TWidgetArtifactSuite = Readonly<{
  name: string;
  command: readonly string[];
  requiredPaths: readonly string[];
}>;

const REPO_ROOT = resolve(import.meta.dir, '..');
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
    name: 'portable manifests, exact release descriptors, builds, and atomic publication',
    command: [
      'bun',
      'test',
      'packages/widget-contract/tests/widget-contract-v1.test.ts',
      'packages/widget-contract/tests/widget-filesystem-boundary.test.ts',
      'packages/widget-contract/tests/widget-release-v1.test.ts',
      'packages/service-agent/tests/widget-filesystem-build.test.ts',
      'packages/service-agent/tests/widget-filesystem/catalog.test.ts',
      'packages/service-agent/tests/widget-filesystem/publication.atomic.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/widget-contract/tests/widget-contract-v1.test.ts',
      'packages/widget-contract/tests/widget-filesystem-boundary.test.ts',
      'packages/widget-contract/tests/widget-release-v1.test.ts',
      'packages/service-agent/tests/widget-filesystem-build.test.ts',
      'packages/service-agent/tests/widget-filesystem/catalog.test.ts',
      'packages/service-agent/tests/widget-filesystem/publication.atomic.test.ts',
    ],
  },
  {
    name: 'production startup catalog, release trust, placement, and runtime loading',
    command: [
      'bun',
      'test',
      'apps/cli/tests/WidgetFilesystemRuntimeCatalog.test.ts',
      'apps/cli/tests/WidgetReleaseAttestationService.test.ts',
      'apps/cli/tests/WidgetFilesystemEndToEnd.test.ts',
      'packages/api/src/widget/contract.test.ts',
      'packages/api/src/widget/api.placement-resolve.test.ts',
      'packages/api/src/widget/fn.catalog-event.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'apps/cli/tests/WidgetFilesystemRuntimeCatalog.test.ts',
      'apps/cli/tests/WidgetReleaseAttestationService.test.ts',
      'apps/cli/tests/WidgetFilesystemEndToEnd.test.ts',
      'packages/api/src/widget/contract.test.ts',
      'packages/api/src/widget/api.placement-resolve.test.ts',
      'packages/api/src/widget/fn.catalog-event.test.ts',
    ],
  },
  {
    name: 'browser safety, filesystem authority, and retired-control-plane boundaries',
    command: ['bun', 'test', 'scripts/widget-artifact-boundary.test.ts'],
    requiredPaths: ['scripts/widget-artifact-boundary.test.ts'],
  },
  {
    name: 'catalog event invalidation and published portal remount',
    command: [
      'bun',
      'run',
      '--cwd',
      'packages/ui-ai-chat',
      'test',
      '--',
      'tests/widget-runtime/WidgetUiRuntime.test.ts',
      'tests/canvas-extension/fn.widget-catalog-event.test.ts',
    ],
    requiredPaths: [
      'packages/ui-ai-chat/tests/widget-runtime/WidgetUiRuntime.test.ts',
      'packages/ui-ai-chat/tests/canvas-extension/fn.widget-catalog-event.test.ts',
    ],
  },
  {
    name: 'ephemeral process-owned Preview build, load, close, and invoke',
    command: [
      'bun',
      'test',
      'apps/cli/tests/WidgetPreviewService.test.ts',
      'packages/service-agent/tests/widget-filesystem/preview-ephemeral.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'apps/cli/tests/WidgetPreviewService.test.ts',
      'packages/service-agent/tests/widget-filesystem/preview-ephemeral.test.ts',
    ],
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

console.log(`\n[widget-artifacts] passed all ${suites.length} filesystem widget suites`);
