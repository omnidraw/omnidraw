#!/usr/bin/env bun

/**
 * Permanent M10 acceptance runner.
 *
 * The Docker wrapper invokes this from an immutable archive of HEAD. A normal
 * checkout additionally runs git's whitespace gate before the durable and
 * common product gates.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type TAcceptanceSuite = {
  readonly name: string;
  readonly command: readonly string[];
};

const REPO_ROOT = resolve(import.meta.dir, '..');
const cleanSnapshot = Bun.argv.slice(2).includes('--clean-snapshot');
const unknownArguments = Bun.argv.slice(2).filter((argument) => argument !== '--clean-snapshot');

if (unknownArguments.length > 0) {
  throw new Error(`Unknown final-acceptance arguments: ${unknownArguments.join(', ')}`);
}
if (cleanSnapshot && process.env.OMNIDRAW_CLEAN_TRACKED_SNAPSHOT !== '1') {
  throw new Error('--clean-snapshot is reserved for the immutable tracked Docker snapshot.');
}

const durableSuites: readonly TAcceptanceSuite[] = [
  { name: 'canvas regression', command: ['bun', 'run', 'test:canvas-regression'] },
  { name: 'strict database schema', command: ['bun', 'run', 'db:schema:verify'] },
  { name: 'database constraints', command: ['bun', 'run', 'db:constraints:test'] },
  { name: 'database recovery', command: ['bun', 'run', 'db:recovery:test'] },
  { name: 'resource runtime', command: ['bun', 'run', 'test:resource-runtime'] },
  { name: 'widget artifacts', command: ['bun', 'run', 'test:widget-artifacts'] },
  { name: 'function runtime', command: ['bun', 'run', 'test:function-runtime'] },
  { name: 'widget host', command: ['bun', 'run', 'test:widget-host'] },
  { name: 'external composition', command: ['bun', 'run', 'test:external-composition'] },
  { name: 'architecture boundaries', command: ['bun', 'run', 'test:architecture'] },
  { name: 'packed public composition', command: ['bun', 'run', 'test:packed-public-composition'] },
  { name: 'load and bounded-cost acceptance', command: ['bun', 'run', 'test:m10:load'] },
];
const hostBoundarySuites: readonly TAcceptanceSuite[] = [
  { name: 'packed canvas-kernel browser consumer', command: ['bun', 'run', 'test:packed-canvas-kernel'] },
  { name: 'Capsule browser sandbox', command: ['bun', 'run', 'test:capsule-browser'] },
  { name: 'Widget npm distribution build', command: ['bun', 'test', 'apps/cli/tests/WidgetNpmDistributionBuild.test.ts'] },
];
const commonSuites: readonly TAcceptanceSuite[] = [
  { name: 'complete product test', command: ['bun', 'run', 'test'] },
  { name: 'workspace build', command: ['bun', 'run', 'build'] },
];

async function runSuite(suite: TAcceptanceSuite, env: NodeJS.ProcessEnv): Promise<void> {
  console.log(`\n[final-acceptance] ${suite.name}`);
  const child = Bun.spawn([...suite.command], {
    cwd: REPO_ROOT,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${suite.name} failed with exit code ${exitCode}`);
  }
}

const acceptanceHome = await mkdtemp(join(tmpdir(), 'omnidraw-final-acceptance-home-'));
try {
  if ((await readdir(acceptanceHome)).length !== 0) {
    throw new Error(`Final-acceptance home was not empty: ${acceptanceHome}`);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: process.env.CI ?? '1',
    OMNIDRAW_CLEAN_TRACKED_SNAPSHOT: cleanSnapshot ? '1' : process.env.OMNIDRAW_CLEAN_TRACKED_SNAPSHOT,
    OMNIDRAW_HOME: acceptanceHome,
    OMNIDRAW_REQUIRE_FD_INSPECTION: '1',
    OMNIDRAW_SILENT_DB_MIGRATIONS: '1',
    VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? '2',
  };

  if (!cleanSnapshot) {
    await runSuite({ name: 'git whitespace gate', command: ['git', 'diff', '--check'] }, env);
  } else {
    console.log('\n[final-acceptance] immutable git archive supplied by Docker wrapper');
    console.log(
      '[final-acceptance] host browser and nested OCI gates remain assigned to host final acceptance',
    );
  }

  const suites = [
    ...durableSuites,
    ...(cleanSnapshot ? [] : hostBoundarySuites),
    ...commonSuites,
  ];
  for (const suite of suites) {
    await runSuite(suite, env);
  }
} finally {
  await rm(acceptanceHome, { recursive: true, force: true });
}

console.log('\n[final-acceptance] all durable, common, and workspace build gates passed');
