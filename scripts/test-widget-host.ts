#!/usr/bin/env bun

/**
 * @file Durable M7 gate for the neutral renderer host and UI scale.
 */

import { resolve } from 'node:path';

type TWidgetHostSuite = Readonly<{
  name: string;
  command: readonly string[];
  requiredPaths: readonly string[];
}>;

const REPO_ROOT = resolve(import.meta.dir, '..');

const suites: readonly TWidgetHostSuite[] = [
  {
    name: 'pinned Automerge peer, document, and synchronization cleanup guards are installed',
    command: ['node', 'scripts/patch-automerge-repo-throttle.mjs', '--check'],
    requiredPaths: [
      'scripts/patch-automerge-repo-throttle.mjs',
      'packages/service-automerge/node_modules/@automerge/automerge-repo/dist/Repo.js',
      'packages/service-automerge/node_modules/@automerge/automerge-repo/dist/synchronizer/DocSynchronizer.js',
      'packages/service-automerge/node_modules/@automerge/automerge-repo/dist/synchronizer/CollectionSynchronizer.js',
    ],
  },
  {
    name: 'pinned Arrow sandbox DOM, CSS, lifecycle, and execution guards are installed',
    command: ['node', 'scripts/patch-arrow-sandbox-security.mjs', '--check'],
    requiredPaths: [
      'scripts/patch-arrow-sandbox-security.mjs',
      'packages/ui-ai-chat/node_modules/@arrow-js/sandbox/src/host/renderer.ts',
      'packages/ui-ai-chat/node_modules/@arrow-js/sandbox/src/host/quickjs.ts',
    ],
  },
  {
    name: 'neutral canvas schema accepts pinned widget-instance metadata',
    command: [
      'bun',
      'test',
      'packages/service-automerge/tests/canvas-doc.schema.test.ts',
    ],
    requiredPaths: [
      'packages/service-automerge/tests/canvas-doc.schema.test.ts',
    ],
  },
  {
    name: 'neutral host normalization, cloning, and frame behavior under the canvas DOM harness',
    command: [
      'bun',
      'run',
      '--cwd',
      'packages/canvas',
      'test',
      '--',
      'tests/widget-host/neutral-widget-host.test.ts',
    ],
    requiredPaths: [
      'packages/canvas/tests/widget-host/neutral-widget-host.test.ts',
      'packages/canvas/vitest.config.ts',
    ],
  },
  {
    name: 'coalesced projection, shared transaction lane, and state-document authorization',
    command: [
      'bun',
      'test',
      'packages/service-automerge/tests/AutomergeService.test.ts',
      'packages/service-automerge/tests/widget-instance-projection.test.ts',
      'packages/service-db/src/tests/CollaborationDocumentAuthorizationStoreTurso.test.ts',
      'packages/service-db/src/tests/WidgetInstanceMetadataStoreTurso.test.ts',
      'apps/cli/src/managed-transaction-lane.integration.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/service-automerge/tests/AutomergeService.test.ts',
      'packages/service-automerge/tests/widget-instance-projection.test.ts',
      'packages/service-db/src/tests/CollaborationDocumentAuthorizationStoreTurso.test.ts',
      'packages/service-db/src/tests/WidgetInstanceMetadataStoreTurso.test.ts',
      'apps/cli/src/managed-transaction-lane.integration.test.ts',
    ],
  },
  {
    name: 'server-authoritative widget-state frames, ownership, schema, size, and mutation rate',
    command: [
      'bun',
      'test',
      'packages/service-automerge/tests/automerge-repo-lifecycle-patch.test.ts',
      'packages/service-automerge/tests/websocket.adapter.test.ts',
      'packages/service-automerge/tests/turso.adapter.test.ts',
      'packages/service-automerge/tests/widget-state-authority.test.ts',
      'packages/service-automerge/tests/widget-state-sync-containment.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/service-automerge/tests/automerge-repo-lifecycle-patch.test.ts',
      'packages/service-automerge/tests/websocket.adapter.test.ts',
      'packages/service-automerge/tests/turso.adapter.test.ts',
      'packages/service-automerge/tests/widget-state-authority.test.ts',
      'packages/service-automerge/tests/widget-state-sync-containment.test.ts',
    ],
  },
  {
    name: 'pinned browser artifact envelope and exact widget runtime authority',
    command: [
      'bun',
      'test',
      'packages/widget-contract/tests/browser-ui-artifact.test.ts',
      'packages/api/src/widget/contract.test.ts',
      'packages/api/src/context-composition.test.ts',
      'packages/api/src/route-equivalence.test.ts',
      'apps/cli/tests/WidgetRuntimeLoadAdmission.test.ts',
    ],
    requiredPaths: [
      'packages/widget-contract/tests/browser-ui-artifact.test.ts',
      'packages/api/src/widget/contract.test.ts',
      'packages/api/src/context-composition.test.ts',
      'packages/api/src/route-equivalence.test.ts',
      'apps/cli/tests/WidgetRuntimeLoadAdmission.test.ts',
    ],
  },
  {
    name: 'function invocation authority fails closed while exact canvas projection is behind',
    command: [
      'bun',
      'test',
      'packages/service-db/src/tests/FunctionControlStoreTurso.test.ts',
      'apps/cli/tests/FunctionService.test.ts',
      'apps/cli/tests/FunctionRuntimeComposition.test.ts',
      '--timeout=30000',
    ],
    requiredPaths: [
      'packages/service-db/src/tests/FunctionControlStoreTurso.test.ts',
      'apps/cli/tests/FunctionService.test.ts',
      'apps/cli/tests/FunctionRuntimeComposition.test.ts',
    ],
  },
  {
    name: 'generated SDK server-function proxy uses the fixed sandbox-global bridge',
    command: [
      'bun',
      'test',
      'packages/sdk/tests/server-functions.test.ts',
      'packages/sdk/tests/collaborative-state.test.ts',
    ],
    requiredPaths: [
      'packages/sdk/tests/server-functions.test.ts',
      'packages/sdk/tests/collaborative-state.test.ts',
    ],
  },
  {
    name: 'browser artifact mount, lifecycle, interactions, identity, cache, and sandbox security',
    command: [
      'bun',
      'run',
      '--cwd',
      'packages/ui-ai-chat',
      'test',
      '--',
      'tests/widget-runtime',
      'tests/widget/neutral-widget-host.test.ts',
      'tests/widget/tx.attach-dom-portal.test.ts',
      'tests/widget/tx.attach-dom-portal.fullscreen.test.ts',
      'tests/widget/fn.widget-portal-visibility.test.ts',
      'tests/widget/fx.attach-widget-listener.portal-visibility.test.ts',
      'tests/widget/fx.attach-widget-listener.fullscreen.test.ts',
      'tests/widget/grouped-widget-portal.test.ts',
    ],
    requiredPaths: [
      'packages/ui-ai-chat/tests/widget-runtime/WidgetUiRuntime.test.ts',
      'packages/ui-ai-chat/tests/widget-runtime/create-widget-function-host-bridge.test.ts',
      'packages/ui-ai-chat/tests/widget-runtime/mount-widget-ui-artifact.test.ts',
      'packages/ui-ai-chat/tests/widget-runtime/sandbox-interrupt-process.test.ts',
      'packages/ui-ai-chat/tests/widget-runtime/fixtures/infinite-loop-mount.ts',
      'packages/ui-ai-chat/tests/widget/neutral-widget-host.test.ts',
      'packages/ui-ai-chat/tests/widget/tx.attach-dom-portal.test.ts',
      'packages/ui-ai-chat/tests/widget/tx.attach-dom-portal.fullscreen.test.ts',
      'packages/ui-ai-chat/tests/widget/fn.widget-portal-visibility.test.ts',
      'packages/ui-ai-chat/tests/widget/fx.attach-widget-listener.portal-visibility.test.ts',
      'packages/ui-ai-chat/tests/widget/fx.attach-widget-listener.fullscreen.test.ts',
      'packages/ui-ai-chat/tests/widget/grouped-widget-portal.test.ts',
    ],
  },
  {
    name: '10,000 UI-only widgets converge through CRDT projection replay and undo without backend rows',
    command: ['bun', 'test', 'scripts/fixtures/widget-host-10k.test.ts', '--timeout=120000'],
    requiredPaths: ['scripts/fixtures/widget-host-10k.test.ts'],
  },
  {
    name: '10,000 committed widgets traverse the neutral manager, portal, and UI runtime without backend starts',
    command: [
      'bun',
      'run',
      '--cwd',
      'packages/ui-ai-chat',
      'test',
      '--',
      'tests/widget/neutral-widget-host-10k.test.ts',
    ],
    requiredPaths: ['packages/ui-ai-chat/tests/widget/neutral-widget-host-10k.test.ts'],
  },
];

async function assertSuiteExists(suite: TWidgetHostSuite): Promise<void> {
  for (const path of suite.requiredPaths) {
    const file = Bun.file(resolve(REPO_ROOT, path));
    if (!(await file.exists())) {
      throw new Error(`[widget-host] required input is missing for "${suite.name}": ${path}`);
    }
    if (
      path.endsWith('.test.ts')
      && /\b(?:describe|it|test)\.(?:skip|todo)\s*\(/.test(await file.text())
    ) {
      throw new Error(`[widget-host] skipped or unfinished assertion: ${path}`);
    }
  }
}

async function runSuite(suite: TWidgetHostSuite, index: number): Promise<void> {
  await assertSuiteExists(suite);
  console.log(`\n[widget-host ${index + 1}/${suites.length}] ${suite.name}`);
  console.log(`[widget-host] $ ${suite.command.join(' ')}`);
  const subprocess = Bun.spawn([...suite.command], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VIBECANVAS_SILENT_DB_MIGRATIONS: '1',
      VIBECANVAS_SILENT_AUTOMERGE_LOGS: '1',
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) {
    throw new Error(`[widget-host ${index + 1}/${suites.length}] "${suite.name}" failed with exit code ${exitCode}`);
  }
}

for (const [index, suite] of suites.entries()) await runSuite(suite, index);

console.log(`\n[widget-host] passed all ${suites.length} neutral host suites`);
