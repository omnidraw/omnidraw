#!/usr/bin/env bun

/**
 * @file Builds one acceptance-only darwin-arm64 Omnidraw executable and stages
 * its pinned Preview inspection browser shell and signed qualification fixture.
 * This is not a general application release pipeline.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  stagePreviewInspectionReleaseFromWorkspace,
  type TPreviewInspectionReleaseManifest,
} from './stage-preview-inspection-runtime';

const APPLICATION_VERSION = '0.0.0-a117-packaged-smoke';

function parseReleaseRoot(argv: readonly string[]): string {
  const inline = argv.find((argument) => argument.startsWith('--release-root='));
  if (inline !== undefined) return inline.slice('--release-root='.length);
  const index = argv.indexOf('--release-root');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value.length === 0) {
    throw new Error(
      'Usage: bun run scripts/package-preview-inspection-runtime.ts --release-root <empty-release-directory>',
    );
  }
  return value;
}

async function runWorkspaceCommand(
  root: string,
  args: readonly string[],
): Promise<void> {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: root,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Preview inspection packaging prerequisite failed with exit code ${exitCode}.`);
  }
}

type TReleaseRootIdentity = Readonly<{
  device: number;
  inode: number;
}>;

type TPackagePreviewInspectionRuntimePortal = Readonly<{
  platform: string;
  arch: string;
  workspaceRoot: string;
  runPrerequisites: (workspaceRoot: string) => Promise<void>;
  compileExecutable: (
    workspaceRoot: string,
    executablePath: string,
  ) => Promise<void>;
  stageRelease: (args: Readonly<{
    releaseRoot: string;
    applicationVersion: string;
  }>) => Promise<TPreviewInspectionReleaseManifest>;
  writeOutput: (message: string) => void;
}>;

export type TPackagePreviewInspectionRuntimeArgs = Readonly<{
  releaseRoot: string;
  portal?: Partial<TPackagePreviewInspectionRuntimePortal>;
}>;

async function readEmptyReleaseRoot(
  releaseRoot: string,
): Promise<TReleaseRootIdentity> {
  const info = await lstat(releaseRoot).catch(() => null);
  if (
    info === null
    || !info.isDirectory()
    || info.isSymbolicLink()
    || (await readdir(releaseRoot)).length !== 0
  ) {
    throw new Error(
      'Preview inspection acceptance release root must be an existing empty regular directory.',
    );
  }
  return Object.freeze({ device: info.dev, inode: info.ino });
}

async function assertReleaseRootIdentity(
  releaseRoot: string,
  identity: TReleaseRootIdentity,
  expectedEntries: readonly string[],
): Promise<void> {
  const info = await lstat(releaseRoot).catch(() => null);
  const entries = info?.isDirectory() === true && !info.isSymbolicLink()
    ? (await readdir(releaseRoot)).sort()
    : [];
  if (
    info === null
    || !info.isDirectory()
    || info.isSymbolicLink()
    || info.dev !== identity.device
    || info.ino !== identity.inode
    || entries.length !== expectedEntries.length
    || entries.some((entry, index) => entry !== expectedEntries[index])
  ) {
    throw new Error(
      'Preview inspection acceptance release root changed during packaging.',
    );
  }
}

async function runDefaultPrerequisites(workspaceRoot: string): Promise<void> {
  await Promise.all([
    runWorkspaceCommand(workspaceRoot, [
      'run',
      '--cwd',
      'apps/capsule-browser-acceptance',
      'generate',
    ]),
    runWorkspaceCommand(workspaceRoot, [
      'run',
      '--cwd',
      'apps/preview-inspection-shell',
      'build',
    ]),
  ]);
}

async function compileDefaultExecutable(
  workspaceRoot: string,
  executablePath: string,
): Promise<void> {
  const build = await Bun.build({
    entrypoints: [join(workspaceRoot, 'apps', 'cli', 'src', 'main.ts')],
    target: 'bun',
    compile: {
      outfile: executablePath,
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    define: {
      OMNIDRAW_COMPILED: 'true',
      OMNIDRAW_PREVIEW_INSPECTION_PACKAGED_SMOKE: 'true',
      OMNIDRAW_VERSION: JSON.stringify(APPLICATION_VERSION),
    },
    external: ['chromium-bidi/*'],
  });
  if (!build.success) {
    for (const log of build.logs) process.stderr.write(`${log.message}\n`);
    throw new Error('The Preview inspection acceptance CLI did not compile.');
  }
}

async function rollbackTransaction(
  releaseRoot: string,
  transactionRoot: string,
  committedEntries: readonly string[],
): Promise<void> {
  for (const entry of committedEntries.toReversed()) {
    const committed = join(releaseRoot, entry);
    const transactionEntry = join(transactionRoot, entry);
    if (
      await lstat(committed).catch(() => null) !== null
      && await lstat(transactionEntry).catch(() => null) === null
    ) {
      await rename(committed, transactionEntry);
    }
  }
  await rm(transactionRoot, { recursive: true, force: true });
}

/**
 * Builds entirely inside one uniquely-owned transaction directory. A failed
 * attempt removes only that directory and leaves the caller's original empty
 * release-root directory in place, so the same destination can be retried.
 */
export async function packagePreviewInspectionRuntime(
  args: TPackagePreviewInspectionRuntimeArgs,
): Promise<TPreviewInspectionReleaseManifest> {
  const workspaceRoot = args.portal?.workspaceRoot
    ?? resolve(import.meta.dir, '..');
  const releaseRoot = resolve(workspaceRoot, args.releaseRoot);
  const platform = args.portal?.platform ?? process.platform;
  const arch = args.portal?.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(
      `Preview inspection packaged qualification supports only darwin-arm64; received ${platform}-${arch}.`,
    );
  }
  const identity = await readEmptyReleaseRoot(releaseRoot);
  const runPrerequisites = args.portal?.runPrerequisites
    ?? runDefaultPrerequisites;
  const compileExecutable = args.portal?.compileExecutable
    ?? compileDefaultExecutable;
  const stageRelease = args.portal?.stageRelease
    ?? stagePreviewInspectionReleaseFromWorkspace;
  const writeOutput = args.portal?.writeOutput
    ?? ((message: string): void => process.stdout.write(message));

  await runPrerequisites(workspaceRoot);
  await assertReleaseRootIdentity(releaseRoot, identity, []);

  const transactionRoot = await mkdtemp(
    join(releaseRoot, '.preview-inspection-package-'),
  );
  const transactionName = basename(transactionRoot);
  const executablePath = join(transactionRoot, 'bin', 'omnidraw');
  const committedEntries: string[] = [];
  let manifest: TPreviewInspectionReleaseManifest;
  try {
    await mkdir(dirname(executablePath), { recursive: true });
    await compileExecutable(workspaceRoot, executablePath);
    manifest = await stageRelease({
      releaseRoot: transactionRoot,
      applicationVersion: APPLICATION_VERSION,
    });
    await assertReleaseRootIdentity(releaseRoot, identity, [transactionName]);
    const transactionEntries = (await readdir(transactionRoot)).sort();
    if (
      transactionEntries.length !== 2
      || transactionEntries[0] !== 'bin'
      || transactionEntries[1] !== 'share'
    ) {
      throw new Error('Preview inspection acceptance transaction is incomplete.');
    }

    for (const entry of transactionEntries) {
      const destination = join(releaseRoot, entry);
      if (await lstat(destination).catch(() => null) !== null) {
        throw new Error('Preview inspection acceptance release destination changed during commit.');
      }
      await rename(join(transactionRoot, entry), destination);
      committedEntries.push(entry);
    }
    await rmdir(transactionRoot);
  } catch (error) {
    try {
      await rollbackTransaction(releaseRoot, transactionRoot, committedEntries);
      await assertReleaseRootIdentity(releaseRoot, identity, []);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Preview inspection acceptance packaging failed and its transaction could not be fully restored.',
      );
    }
    throw error;
  }

  writeOutput(
    `Packaged the actual Omnidraw CLI and ${manifest.shell.files.length} shell files for ${manifest.target}.\n`,
  );
  return manifest;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dir, '..');
  await packagePreviewInspectionRuntime({
    releaseRoot: resolve(root, parseReleaseRoot(Bun.argv.slice(2))),
  });
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Preview inspection acceptance packaging failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
