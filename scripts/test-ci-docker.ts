#!/usr/bin/env bun

/**
 * Builds and runs final acceptance from an immutable archive of the current
 * commit. The Docker daemon never receives the caller's dirty worktree,
 * node_modules, untracked files, or a writable bind mount.
 */

import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const DOCKERFILE = 'scripts/docker/final-acceptance.Dockerfile';
const requestedPlatform = process.env.VIBECANVAS_DOCKER_PLATFORM?.trim() || undefined;
const REQUIRED_TRACKED_FILES = [
  DOCKERFILE,
  'scripts/test-ci-docker.ts',
  'scripts/test-final-acceptance.ts',
] as const;

if (requestedPlatform && !/^linux\/(?:amd64|arm64)$/.test(requestedPlatform)) {
  throw new Error(
    `VIBECANVAS_DOCKER_PLATFORM must be linux/amd64 or linux/arm64, received ${requestedPlatform}`,
  );
}

const platformArguments = requestedPlatform === undefined
  ? []
  : ['--platform', requestedPlatform];

async function capture(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed (${exitCode}): ${stderr.trim()}`);
  }
  return stdout.trim();
}

async function run(command: readonly string[], cwd = REPO_ROOT): Promise<void> {
  console.log(`[ci-docker] ${command.join(' ')}`);
  const child = Bun.spawn([...command], {
    cwd,
    env: process.env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`${command[0]} failed with exit code ${exitCode}`);
}

const revision = await capture(['git', 'rev-parse', '--verify', 'HEAD']);
for (const path of REQUIRED_TRACKED_FILES) {
  const trackedPath = await capture(['git', 'ls-tree', '--name-only', revision, '--', path]);
  if (trackedPath !== path) {
    throw new Error(`${path} is not present in ${revision}; commit the acceptance infrastructure first.`);
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'vibecanvas-ci-docker-'));
const archivePath = join(temporaryRoot, 'tracked-source.tar');
const contextPath = join(temporaryRoot, 'context');
const imageTag = `vibecanvas-final-acceptance:${revision.slice(0, 12)}`;

try {
  console.log(`[ci-docker] platform ${requestedPlatform ?? 'daemon-native'}`);
  await mkdir(contextPath);
  await run([
    'git',
    'archive',
    '--format=tar',
    `--output=${archivePath}`,
    revision,
  ]);
  await run(['tar', '-xf', archivePath, '-C', contextPath]);
  await run([
    'docker',
    'build',
    ...platformArguments,
    '--file',
    DOCKERFILE,
    '--label',
    `org.opencontainers.image.revision=${revision}`,
    '--tag',
    imageTag,
    '.',
  ], contextPath);
  await run([
    'docker',
    'run',
    '--rm',
    ...platformArguments,
    '--env',
    'CI=1',
    '--env',
    'VIBECANVAS_CLEAN_TRACKED_SNAPSHOT=1',
    '--env',
    'VIBECANVAS_LEGACY_ACTOR_ENABLED=0',
    '--env',
    'VIBECANVAS_REQUIRE_FD_INSPECTION=1',
    imageTag,
  ]);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log(`[ci-docker] immutable revision ${revision} passed final acceptance`);
