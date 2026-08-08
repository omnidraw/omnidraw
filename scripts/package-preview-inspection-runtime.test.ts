import { afterEach, describe, expect, test } from 'bun:test';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  packagePreviewInspectionRuntime,
  type TPackagePreviewInspectionRuntimeArgs,
} from './package-preview-inspection-runtime';
import type {
  TPreviewInspectionReleaseManifest,
} from './stage-preview-inspection-runtime';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

function manifest(): TPreviewInspectionReleaseManifest {
  return {
    format: 'omnidraw.preview-inspection-release.v1',
    target: 'darwin-arm64',
    application: {
      version: '0.0.0-test',
      executableSha256: 'a'.repeat(64),
      executableBytes: 8,
    },
    runtime: {
      packageName: 'playwright',
      packageVersion: '1.61.1',
      browserName: 'chromium',
      browserRevision: '1228',
      browserVersion: '149.0.7827.55',
      executableSha256: 'b'.repeat(64),
      provisionCommand: 'test-only',
    },
    shell: { relativePath: 'shell', totalBytes: 1, files: [] },
    qualification: {
      fixture: {
        path: 'qualification/signed-fixture.json',
        bytes: 1,
        sha256: 'c'.repeat(64),
      },
    },
    licenses: [],
  };
}

describe('Preview inspection acceptance packager transaction', () => {
  test('restores the exact empty release root after failure and permits an immediate retry', async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), 'omnidraw-package-transaction-test-'),
    );
    roots.push(workspaceRoot);
    const releaseRoot = join(workspaceRoot, 'release');
    await mkdir(releaseRoot);
    const initial = await lstat(releaseRoot);
    let failStage = true;
    const args: TPackagePreviewInspectionRuntimeArgs = {
      releaseRoot,
      portal: {
        platform: 'darwin',
        arch: 'arm64',
        workspaceRoot,
        runPrerequisites: async () => {},
        compileExecutable: async (_root, executablePath) => {
          await writeFile(executablePath, 'compiled');
        },
        stageRelease: async ({ releaseRoot: transactionRoot }) => {
          await mkdir(join(transactionRoot, 'share', 'partial'), {
            recursive: true,
          });
          if (failStage) throw new Error('simulated staging failure');
          return manifest();
        },
        writeOutput: () => {},
      },
    };

    await expect(packagePreviewInspectionRuntime(args))
      .rejects.toThrow('simulated staging failure');
    const restored = await lstat(releaseRoot);
    expect({ device: restored.dev, inode: restored.ino }).toEqual({
      device: initial.dev,
      inode: initial.ino,
    });
    expect(await readdir(releaseRoot)).toEqual([]);

    failStage = false;
    await expect(packagePreviewInspectionRuntime(args)).resolves.toMatchObject({
      format: 'omnidraw.preview-inspection-release.v1',
      target: 'darwin-arm64',
    });
    expect(await readFile(join(releaseRoot, 'bin', 'omnidraw'), 'utf8'))
      .toBe('compiled');
    expect((await readdir(releaseRoot)).sort()).toEqual(['bin', 'share']);
  });

  test('rejects nonempty roots without removing their existing data', async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), 'omnidraw-package-preserve-test-'),
    );
    roots.push(workspaceRoot);
    const releaseRoot = join(workspaceRoot, 'release');
    await mkdir(releaseRoot);
    await writeFile(join(releaseRoot, 'keep.txt'), 'keep');

    await expect(packagePreviewInspectionRuntime({
      releaseRoot,
      portal: {
        platform: 'darwin',
        arch: 'arm64',
        workspaceRoot,
        runPrerequisites: async () => {
          throw new Error('must not run');
        },
      },
    })).rejects.toThrow('existing empty regular directory');
    expect(await readFile(join(releaseRoot, 'keep.txt'), 'utf8')).toBe('keep');
  });
});
