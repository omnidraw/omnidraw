#!/usr/bin/env node
/**
 * Git hook helper: keep local Verdaccio for this machine, but never commit
 * loopback tarball URLs in bun.lock. CI installs published npm only.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { restorePublishedLockfileUrls } from './published-lockfile.mjs';

export async function sanitizeLockfileText(lockfileText) {
  const restored = restorePublishedLockfileUrls(lockfileText);
  return { changed: restored !== lockfileText, restored };
}

export async function sanitizeLockfileAt(path) {
  const original = await readFile(path, 'utf8');
  const { changed, restored } = await sanitizeLockfileText(original);
  if (changed) await writeFile(path, restored);
  return changed;
}

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

async function runHook(mode) {
  const rootResult = git(['rev-parse', '--show-toplevel']);
  if (rootResult.status !== 0) return;
  const root = rootResult.stdout.trim();
  const lockPath = join(root, 'bun.lock');
  let changed = false;
  try {
    changed = await sanitizeLockfileAt(lockPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (!changed) return;
  if (mode === 'pre-commit') git(['add', '--', 'bun.lock'], root);
  console.error('[omnidraw] stripped local-registry URLs from bun.lock.');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const mode = process.argv[2] ?? 'pre-commit';
  runHook(mode).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
