#!/usr/bin/env node
/** Copy repo git hooks into this checkout's .git/hooks. No git config changes. */

import { chmod, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const HOOK_NAMES = Object.freeze(['pre-commit', 'pre-push']);

export async function resolveGitDir(repositoryRoot) {
  const gitPath = join(repositoryRoot, '.git');
  const info = await stat(gitPath);
  if (info.isDirectory()) return gitPath;
  const contents = await readFile(gitPath, 'utf8');
  const match = contents.match(/^gitdir:\s*(.+)\s*$/m);
  if (match === null) throw new Error(`Cannot resolve gitdir from ${gitPath}`);
  return resolve(repositoryRoot, match[1]);
}

export async function installGitHooks(repositoryRoot = REPOSITORY_ROOT) {
  let gitDir;
  try {
    gitDir = await resolveGitDir(repositoryRoot);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { installed: false, reason: 'not a git checkout' };
    }
    throw error;
  }
  const destDir = join(gitDir, 'hooks');
  await mkdir(destDir, { recursive: true });
  for (const name of HOOK_NAMES) {
    const dest = join(destDir, name);
    await copyFile(join(repositoryRoot, '.githooks', name), dest);
    await chmod(dest, 0o755);
  }
  return { installed: true, gitDir };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  installGitHooks().then((result) => {
    if (result.installed) {
      console.log(`[install-git-hooks] installed pre-commit and pre-push into ${result.gitDir}/hooks`);
      return;
    }
    console.log(`[install-git-hooks] skipped (${result.reason})`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
