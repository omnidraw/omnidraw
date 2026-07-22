/** @file Shared fail-closed Bun child cage and teardown helpers. */

import { constants } from 'node:fs';
import { lstat, mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

export type TBunChildCage = Readonly<{
  path: string;
  device: number;
  inode: number;
}>;

export type TBunChildProcessGroupController = Readonly<{
  signal(processGroupId: number, signal: NodeJS.Signals): void;
  /** Null means the host can signal the group but cannot probe it (for example, a seatbelt sandbox). */
  exists(processGroupId: number): boolean | null;
}>;

const DEFAULT_PROCESS_GROUP_CONTROLLER: TBunChildProcessGroupController = Object.freeze({
  signal: (processGroupId, signal) => {
    if (process.platform === 'win32') return;
    process.kill(-processGroupId, signal);
  },
  exists: (processGroupId) => {
    if (process.platform === 'win32') return false;
    try {
      process.kill(-processGroupId, 0);
      return true;
    } catch (error) {
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') {
        return false;
      }
      if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        return null;
      }
      throw error;
    }
  },
});

export function defaultBunChildTempRoot(): string {
  return tmpdir();
}

/** Reads authoritative host RSS for the direct child; zero means it is no longer observable. */
export async function readBunChildRssBytes(processId: number): Promise<number> {
  const measurement = Bun.spawn(['ps', '-o', 'rss=', '-p', String(processId)], {
    stdout: 'pipe',
    stderr: 'ignore',
    env: {},
  });
  const text = await new Response(measurement.stdout).text();
  const exit = await measurement.exited;
  if (exit !== 0) return 0;
  const kibibytes = Number.parseInt(text.trim(), 10);
  return Number.isFinite(kibibytes) && kibibytes > 0 ? kibibytes * 1_024 : 0;
}

export async function createBunChildCage(tempRoot: string): Promise<TBunChildCage> {
  const root = await lstat(tempRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('Function child temp root must be a real directory.');
  }
  const path = await mkdtemp(join(resolve(tempRoot), 'vibecanvas-function-'));
  const created = await lstat(path);
  if (!created.isDirectory() || created.isSymbolicLink()) {
    // The path no longer names the directory returned by mkdtemp. Retain an
    // unverified replacement instead of recursively deleting attacker-chosen
    // contents.
    throw new Error('Function child cage must be a real directory.');
  }
  const cage = Object.freeze({
    path,
    device: Number(created.dev),
    inode: Number(created.ino),
  });
  try {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      const opened = await handle.stat();
      if (
        !opened.isDirectory()
        || Number(opened.dev) !== cage.device
        || Number(opened.ino) !== cage.inode
      ) {
        throw new Error('Function child cage identity changed while it was opened.');
      }
      await handle.chmod(0o700);
      const linked = await lstat(path);
      if (
        !linked.isDirectory()
        || linked.isSymbolicLink()
        || Number(linked.dev) !== cage.device
        || Number(linked.ino) !== cage.inode
      ) {
        throw new Error('Function child cage identity changed while it was secured.');
      }
    } finally {
      await handle.close();
    }
    return cage;
  } catch (error) {
    try {
      await removeBunChildCage(cage);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Function child cage creation failed and verified cleanup did not complete.',
      );
    }
    throw error;
  }
}

async function waitForExit(process: Bun.Subprocess, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    process.exited.then(() => true, () => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export async function removeBunChildCage(cage: TBunChildCage): Promise<void> {
  const value = await lstat(cage.path);
  if (
    !value.isDirectory()
    || value.isSymbolicLink()
    || Number(value.dev) !== cage.device
    || Number(value.ino) !== cage.inode
  ) {
    throw new Error('Function child cage identity changed before cleanup.');
  }
  await rm(cage.path, { recursive: true, force: false });
}

function signalDirectProcess(process: Bun.Subprocess, signal: NodeJS.Signals): void {
  try { process.kill(signal); } catch { /* direct child may already be reaped */ }
}

function signalProcessGroup(
  controller: TBunChildProcessGroupController,
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    controller.signal(processGroupId, signal);
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
}

async function waitForProcessGroupExit(
  controller: TBunChildProcessGroupController,
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean | null> {
  const deadlineAtMs = Date.now() + timeoutMs;
  while (true) {
    const exists = controller.exists(processGroupId);
    if (exists === null) return null;
    if (!exists) return true;
    const remainingMs = deadlineAtMs - Date.now();
    if (remainingMs <= 0) return false;
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, Math.min(remainingMs, 10));
    });
  }
}

type TProcessGroupExitObservation = Readonly<{
  exited: boolean | null;
  error: unknown | null;
}>;

async function observeProcessGroupExit(
  controller: TBunChildProcessGroupController,
  processGroupId: number,
  timeoutMs: number,
): Promise<TProcessGroupExitObservation> {
  try {
    return { exited: await waitForProcessGroupExit(controller, processGroupId, timeoutMs), error: null };
  } catch (error) {
    return { exited: null, error };
  }
}

export async function terminateBunChild(
  process: Bun.Subprocess,
  cage: TBunChildCage,
  graceMs: number,
  processGroups: TBunChildProcessGroupController = DEFAULT_PROCESS_GROUP_CONTROLLER,
): Promise<void> {
  const processGroupId = process.pid;
  let termSignalError: unknown | null = null;
  try {
    signalProcessGroup(processGroups, processGroupId, 'SIGTERM');
  } catch (error) {
    termSignalError = error;
  }
  signalDirectProcess(process, 'SIGTERM');
  const [childExited, termGroup] = await Promise.all([
    waitForExit(process, graceMs),
    observeProcessGroupExit(processGroups, processGroupId, graceMs),
  ]);
  if (
    termSignalError !== null
    || termGroup.error !== null
    || !childExited
    || termGroup.exited !== true
  ) {
    let killSignalError: unknown | null = null;
    try {
      signalProcessGroup(processGroups, processGroupId, 'SIGKILL');
    } catch (error) {
      killSignalError = error;
    }
    signalDirectProcess(process, 'SIGKILL');
    const killWaitMs = Math.max(graceMs, 100);
    const [childKilled, killGroup] = await Promise.all([
      waitForExit(process, killWaitMs),
      observeProcessGroupExit(processGroups, processGroupId, killWaitMs),
    ]);
    const groupKillProven = killGroup.exited === true
      || (
        killGroup.exited === null
        && killGroup.error === null
        && killSignalError === null
      );
    if (!childKilled || !groupKillProven) {
      throw new AggregateError(
        [termSignalError, termGroup.error, killSignalError, killGroup.error]
          .filter((error) => error !== null),
        `Function child process group ${processGroupId} survived SIGKILL; its cage was retained.`,
      );
    }
  }
  await removeBunChildCage(cage);
}
