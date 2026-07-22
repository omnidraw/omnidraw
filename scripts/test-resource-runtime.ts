#!/usr/bin/env bun

/**
 * @file Durable M4 gate for the actor-independent, single-owner resource runtime.
 */

import { resolve } from 'node:path';

type TResourceRuntimeSuite = {
  readonly command: readonly string[];
  readonly name: string;
};

const REPO_ROOT = resolve(import.meta.dir, '..');

const suites: readonly TResourceRuntimeSuite[] = [
  {
    name: 'package boundaries and logical-executor file ownership',
    command: ['bun', 'test', 'scripts/resource-runtime-boundary.test.ts'],
  },
  {
    name: 'public contracts, owner fencing, call serialization, and recovery',
    command: ['bun', 'test', 'packages/resource-runtime/tests', '--timeout=30000'],
  },
  {
    name: 'catalog, placement, binding, lifecycle, and key custody',
    command: ['bun', 'test', 'packages/service-db/src/tests/ResourceControlStoreTurso.test.ts'],
  },
  {
    name: 'neutral resource API, legacy delegation, and tenant-first composition',
    command: [
      'bun',
      'test',
      'packages/api/src/resource',
      'packages/api/src/context-composition.test.ts',
      'packages/api/src/route-equivalence.test.ts',
      '--timeout=30000',
    ],
  },
  {
    name: 'production composition, owner shutdown, and active-use lease fencing',
    command: [
      'bun',
      'test',
      'apps/cli/tests/ResourceComposition.test.ts',
      'apps/cli/tests/ResourceServiceOwnership.test.ts',
      'apps/cli/tests/ResourceUseCoordinatorBridge.test.ts',
      'apps/cli/tests/TenantServicePool.test.ts',
      'apps/cli/tests/LazyTenantServiceCapability.test.ts',
      'packages/service-actor/tests/ActorService.resource-apply.test.ts',
      'packages/service-actor/tests/ActorService.resource-data.test.ts',
      '--timeout=30000',
    ],
  },
];

async function runSuite(suite: TResourceRuntimeSuite): Promise<void> {
  console.log(`\n[resource-runtime] ${suite.name}`);
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
  if (exitCode !== 0) throw new Error(`${suite.name} failed with exit code ${exitCode}`);
}

for (const suite of suites) await runSuite(suite);

console.log(`\n[resource-runtime] passed ${suites.length} ownership and recovery suites`);
