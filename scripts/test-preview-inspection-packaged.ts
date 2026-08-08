#!/usr/bin/env bun

/**
 * @file Runs the complete acceptance-only packaged Preview inspection
 * qualification in one fresh, automatically cleaned release directory.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CONDITIONAL_FLAG = '--if-supported';

async function runWorkspaceCommand(
  root: string,
  command: string,
  releaseRoot: string,
): Promise<void> {
  const child = Bun.spawn([
    process.execPath,
    'run',
    command,
    '--release-root',
    releaseRoot,
  ], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(
      `Preview inspection packaged qualification command ${command} failed with exit code ${exitCode}.`,
    );
  }
}

async function main(): Promise<void> {
  const supported = process.platform === 'darwin' && process.arch === 'arm64';
  const conditional = Bun.argv.slice(2).includes(CONDITIONAL_FLAG);
  if (!supported) {
    if (conditional) {
      process.stdout.write(
        `Skipping packaged Preview inspection qualification on unsupported host ${process.platform}-${process.arch}.\n`,
      );
      return;
    }
    throw new Error(
      `Packaged Preview inspection qualification requires darwin-arm64; received ${process.platform}-${process.arch}.`,
    );
  }

  const root = resolve(import.meta.dir, '..');
  const releaseRoot = await mkdtemp(join(tmpdir(), 'omnidraw-preview-inspection-qualified-'));
  let primaryError: unknown;
  try {
    await runWorkspaceCommand(root, 'package:preview-inspection-runtime', releaseRoot);
    await runWorkspaceCommand(root, 'smoke:preview-inspection-runtime', releaseRoot);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await rm(releaseRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError === undefined) throw cleanupError;
      throw new AggregateError(
        [primaryError, cleanupError],
        'Packaged Preview inspection qualification and cleanup both failed.',
      );
    }
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Packaged Preview inspection qualification failed.'}\n`,
  );
  process.exitCode = 1;
});
