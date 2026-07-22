#!/usr/bin/env bun

/**
 * @file Durable M3 gate for tenant authority, collision, and foreign-ID behavior.
 */

import { resolve } from 'node:path';

type TIsolationSuite = {
  readonly command: readonly string[];
  readonly name: string;
};

const REPO_ROOT = resolve(import.meta.dir, '..');

const suites: readonly TIsolationSuite[] = [
  {
    name: 'tenant derivation and immutable global-scope allowlist',
    command: [
      'bun',
      'test',
      'scripts/tenant-authority-boundary.test.ts',
      'packages/tenant-core/tests/tenant-core.test.ts',
      'packages/service-db/src/verification/default-tenant-authority.test.ts',
      'packages/api/src/agent/authorization-forwarding.test.ts',
      'apps/cli/tests/auth.tenant-context.test.ts',
      'apps/cli/tests/TenantServicePool.test.ts',
    ],
  },
  {
    name: 'repository collisions, resources, agents, actors, and foreign IDs',
    command: [
      'bun',
      'test',
      'packages/service-db/src/verification/repository-isolation.test.ts',
      'packages/api/src/tenant-isolation.test.ts',
      '--timeout=30000',
    ],
  },
  {
    name: 'canvas collaboration admission, persistence, replay, and handle bounds',
    command: [
      'bun',
      'test',
      'packages/service-automerge/tests/AutomergeService.test.ts',
      'packages/service-automerge/tests/turso.adapter.test.ts',
      'packages/service-automerge/tests/websocket.adapter.test.ts',
      '--timeout=30000',
    ],
  },
  {
    name: 'events, wildcard topics, cursors, notifications, and context composition',
    command: [
      'bun',
      'test',
      'packages/service-event-publisher/src/EventPublisherService.test.ts',
      'packages/api/src/db/db-events.test.ts',
      'packages/api/src/notification/notification-events.test.ts',
      'packages/api/src/context-composition.test.ts',
    ],
  },
  {
    name: 'media HTTP authority and no-existence-leak responses',
    command: ['bun', 'test', 'apps/cli/tests/server.http.test.ts'],
  },
  {
    name: 'browser organization and placement cache switching',
    command: [
      'bun',
      'run',
      '--cwd',
      'packages/canvas',
      'test',
      '--',
      'tests/browser-tenant-scope.test.ts',
      'tests/browser-automerge-session.test.ts',
    ],
  },
  {
    name: 'browser connection, subscription, and persisted-store teardown order',
    command: [
      'bun',
      'run',
      '--cwd',
      'apps/frontend',
      'test',
    ],
  },
];

async function runSuite(suite: TIsolationSuite): Promise<void> {
  console.log(`\n[tenant-isolation] ${suite.name}`);
  const subprocess = Bun.spawn([...suite.command], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VIBECANVAS_SILENT_AUTOMERGE_LOGS: '1',
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

console.log(`\n[tenant-isolation] passed ${suites.length} authority suites`);
