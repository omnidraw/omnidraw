import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolvePreviewInspectionReleaseRuntime,
} from '../src/services/preview-inspection/preview-inspection-release-runtime';

const SHA256 = 'a'.repeat(64);

describe('Preview inspection release runtime layout', () => {
  let root: string;
  let binaryPath: string;
  let runtimeRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnidraw-inspection-layout-'));
    binaryPath = join(root, 'bin', 'omnidraw');
    runtimeRoot = join(root, 'share', 'omnidraw', 'preview-inspection');
    await mkdir(runtimeRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('resolves the source shell without requiring release evidence', () => {
    const runtime = resolvePreviewInspectionReleaseRuntime({
      compiled: false,
      executablePath: '/ignored/bin/omnidraw',
      sourceCliDir: '/repo/apps/cli/src',
      platform: 'linux',
      arch: 'x64',
    });

    expect(runtime).toEqual({
      shellPath: '/repo/apps/preview-inspection-shell/dist',
      releaseManifestRequired: false,
    });
  });

  test('accepts only the exact compiled target and runtime pin', async () => {
    const shellBytes = Buffer.from('<!doctype html>');
    await mkdir(join(runtimeRoot, 'shell'), { recursive: true });
    await writeFile(join(runtimeRoot, 'shell', 'index.html'), shellBytes);
    await writeFile(join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify({
      format: 'omnidraw.preview-inspection-release.v1',
      target: 'darwin-arm64',
      runtime: {
        packageName: 'playwright',
        packageVersion: '1.61.1',
        browserName: 'chromium',
        browserRevision: '1228',
        browserVersion: '149.0.7827.55',
        executableSha256: SHA256,
      },
      shell: {
        relativePath: 'shell',
        totalBytes: shellBytes.byteLength,
        files: [{
          path: 'shell/index.html',
          bytes: shellBytes.byteLength,
          sha256: createHash('sha256').update(shellBytes).digest('hex'),
        }],
      },
    }));

    expect(resolvePreviewInspectionReleaseRuntime({
      compiled: true,
      executablePath: binaryPath,
      sourceCliDir: '/ignored',
      platform: 'darwin',
      arch: 'arm64',
    })).toEqual({
      shellPath: join(runtimeRoot, 'shell'),
      releaseManifestRequired: true,
      expectedExecutableSha256: SHA256,
    });
  });

  test('rejects a corrupted staged shell even when browser evidence is valid', async () => {
    const original = Buffer.from('<!doctype html>');
    await mkdir(join(runtimeRoot, 'shell'), { recursive: true });
    await writeFile(join(runtimeRoot, 'shell', 'index.html'), 'corrupt');
    await writeFile(join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify({
      format: 'omnidraw.preview-inspection-release.v1',
      target: 'darwin-arm64',
      runtime: {
        packageName: 'playwright',
        packageVersion: '1.61.1',
        browserName: 'chromium',
        browserRevision: '1228',
        browserVersion: '149.0.7827.55',
        executableSha256: SHA256,
      },
      shell: {
        relativePath: 'shell',
        totalBytes: original.byteLength,
        files: [{
          path: 'shell/index.html',
          bytes: original.byteLength,
          sha256: createHash('sha256').update(original).digest('hex'),
        }],
      },
    }));

    expect(resolvePreviewInspectionReleaseRuntime({
      compiled: true,
      executablePath: binaryPath,
      sourceCliDir: '/ignored',
      platform: 'darwin',
      arch: 'arm64',
    }).expectedExecutableSha256).toBeUndefined();
  });

  test('keeps checksum absent for missing, malformed, drifted, or wrong-target evidence', async () => {
    const args = {
      compiled: true,
      executablePath: binaryPath,
      sourceCliDir: '/ignored',
      platform: 'darwin',
      arch: 'arm64',
    } as const;
    expect(resolvePreviewInspectionReleaseRuntime(args))
      .toEqual({ shellPath: join(runtimeRoot, 'shell'), releaseManifestRequired: true });

    for (const manifest of [
      '{bad-json',
      JSON.stringify({ format: 'wrong', target: 'darwin-arm64', runtime: {} }),
      JSON.stringify({
        format: 'omnidraw.preview-inspection-release.v1',
        target: 'darwin-arm64',
        runtime: {
          packageName: 'playwright',
          packageVersion: '1.61.1',
          browserName: 'chromium',
          browserRevision: '1228',
          browserVersion: '149.0.7827.55',
          executableSha256: SHA256,
        },
      }),
      JSON.stringify({
        format: 'omnidraw.preview-inspection-release.v1',
        target: 'darwin-arm64',
        runtime: {
          packageName: 'playwright',
          packageVersion: '1.61.1',
          browserName: 'chromium',
          browserRevision: '1229',
          browserVersion: '149.0.7827.55',
          executableSha256: SHA256,
        },
      }),
    ]) {
      await writeFile(join(runtimeRoot, 'runtime-manifest.json'), manifest);
      expect(resolvePreviewInspectionReleaseRuntime(args).expectedExecutableSha256)
        .toBeUndefined();
    }
  });

  test('fails closed for every unqualified compiled target', async () => {
    const shellBytes = Buffer.from('<!doctype html>');
    await mkdir(join(runtimeRoot, 'shell'), { recursive: true });
    await writeFile(join(runtimeRoot, 'shell', 'index.html'), shellBytes);
    await writeFile(join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify({
      format: 'omnidraw.preview-inspection-release.v1',
      target: 'linux-x64',
      runtime: {
        packageName: 'playwright',
        packageVersion: '1.61.1',
        browserName: 'chromium',
        browserRevision: '1228',
        browserVersion: '149.0.7827.55',
        executableSha256: SHA256,
      },
      shell: {
        relativePath: 'shell',
        totalBytes: shellBytes.byteLength,
        files: [{
          path: 'shell/index.html',
          bytes: shellBytes.byteLength,
          sha256: createHash('sha256').update(shellBytes).digest('hex'),
        }],
      },
    }));

    expect(resolvePreviewInspectionReleaseRuntime({
      compiled: true,
      executablePath: binaryPath,
      sourceCliDir: '/ignored',
      platform: 'linux',
      arch: 'x64',
    }).expectedExecutableSha256).toBeUndefined();
  });
});
