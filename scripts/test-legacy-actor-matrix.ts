#!/usr/bin/env bun

/**
 * Runs the complete product suite with the optional legacy actor plugin both
 * disabled and enabled. The normal product default is disabled.
 */

import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

const modes = [
  { name: 'disabled', value: '0' },
  { name: 'enabled', value: '1' },
] as const;

for (const mode of modes) {
  console.log(`\n[legacy-actor-matrix] full product suite: ${mode.name}`);
  const child = Bun.spawn(['bun', 'run', 'test'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      VIBECANVAS_LEGACY_ACTOR_ENABLED: mode.value,
      VIBECANVAS_SILENT_DB_MIGRATIONS: '1',
      // The canvas suite uses memory-heavy isolated jsdom workers. Keep the
      // two-mode acceptance run bounded while allowing CI to choose a lower
      // or higher cap explicitly.
      VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? '2',
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Full product suite failed with legacy actors ${mode.name} (exit ${exitCode}).`);
  }
}

console.log('\n[legacy-actor-matrix] both complete product modes passed');
