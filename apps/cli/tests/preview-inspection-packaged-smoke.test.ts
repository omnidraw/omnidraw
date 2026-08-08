import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePackagedSmokeSuccessDto,
} from '../../../scripts/smoke-preview-inspection-runtime';
import {
  readPreviewInspectionPackagedSmokeRelease,
} from '../src/preview-inspection-packaged-smoke';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('Preview inspection packaged smoke boundary', () => {
  let root: string;
  let executablePath: string;
  let runtimeRoot: string;
  let fixturePath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnidraw-packaged-smoke-test-'));
    executablePath = join(root, 'bin', 'omnidraw');
    runtimeRoot = join(root, 'share', 'omnidraw', 'preview-inspection');
    fixturePath = join(runtimeRoot, 'qualification', 'signed-fixture.json');
    await mkdir(join(root, 'bin'), { recursive: true });
    await mkdir(join(runtimeRoot, 'shell'), { recursive: true });
    await mkdir(join(runtimeRoot, 'qualification'), { recursive: true });
    const executable = Buffer.from('compiled-omnidraw');
    const shell = Buffer.from('<!doctype html>');
    const artifact = Buffer.from('signed-artifact');
    const fixture = Buffer.from(JSON.stringify({
      format: 'omnidraw.preview-inspection-packaged-smoke-fixture.v1',
      publicKeys: {
        preview: {
          keyId: 'preview',
          algorithm: 'Ed25519',
          format: 'raw',
          publicKeyBase64: 'A'.repeat(43) + '=',
        },
        release: {
          keyId: 'release',
          algorithm: 'Ed25519',
          format: 'raw',
          publicKeyBase64: 'B'.repeat(43) + '=',
        },
      },
      host: {
        generation: 'packaged-smoke-test-v1',
        allowedApis: ['DOM'],
        limits: {},
        previewSigningKeyId: 'preview',
        releaseSigningKeyId: 'release',
      },
      artifact: {
        digestSha256: sha256(artifact),
        bytesBase64: artifact.toString('base64'),
        capsuleArtifactHash: `sha256:${'c'.repeat(64)}`,
        runtimeDescriptor: { format: 'test' },
        functionDescriptors: [],
        browserFunctionDescriptorsDigestSha256: 'd'.repeat(64),
      },
    }));
    await Promise.all([
      writeFile(executablePath, executable),
      writeFile(join(runtimeRoot, 'shell', 'index.html'), shell),
      writeFile(fixturePath, fixture),
    ]);
    await writeFile(join(runtimeRoot, 'runtime-manifest.json'), JSON.stringify({
      format: 'omnidraw.preview-inspection-release.v1',
      target: 'darwin-arm64',
      application: {
        version: '0.0.0-test',
        executableSha256: sha256(executable),
        executableBytes: executable.byteLength,
      },
      runtime: {
        packageName: 'playwright',
        packageVersion: '1.61.1',
        browserName: 'chromium',
        browserRevision: '1228',
        browserVersion: '149.0.7827.55',
        executableSha256: 'a'.repeat(64),
      },
      shell: {
        relativePath: 'shell',
        totalBytes: shell.byteLength,
        files: [{
          path: 'shell/index.html',
          bytes: shell.byteLength,
          sha256: sha256(shell),
        }],
      },
      qualification: {
        fixture: {
          path: 'qualification/signed-fixture.json',
          bytes: fixture.byteLength,
          sha256: sha256(fixture),
        },
      },
    }));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('accepts only a self-hashed application and hash-pinned staged fixture', async () => {
    const release = await readPreviewInspectionPackagedSmokeRelease({
      executablePath,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(release).toMatchObject({
      applicationVersion: '0.0.0-test',
      expectedBrowserExecutableSha256: 'a'.repeat(64),
      resultPath: join(runtimeRoot, 'qualification', 'smoke-result.png'),
      fixture: {
        artifact: {
          capsuleArtifactHash: `sha256:${'c'.repeat(64)}`,
        },
      },
    });
  });

  test('rejects fixture mutation and every unqualified target', async () => {
    await writeFile(fixturePath, '{"tampered":true}');
    await expect(readPreviewInspectionPackagedSmokeRelease({
      executablePath,
      platform: 'darwin',
      arch: 'arm64',
    })).rejects.toMatchObject({ code: 'PACKAGED_SMOKE_FIXTURE_INVALID' });

    await expect(readPreviewInspectionPackagedSmokeRelease({
      executablePath,
      platform: 'linux',
      arch: 'x64',
    })).rejects.toMatchObject({ code: 'PACKAGED_SMOKE_TARGET_UNSUPPORTED' });
  });

  test('opens the manifest-pinned fixture without following a symbolic link', async () => {
    const fixtureTarget = join(runtimeRoot, 'qualification', 'fixture-target.json');
    await rename(fixturePath, fixtureTarget);
    await symlink(fixtureTarget, fixturePath);

    await expect(readPreviewInspectionPackagedSmokeRelease({
      executablePath,
      platform: 'darwin',
      arch: 'arm64',
    })).rejects.toMatchObject({ code: 'PACKAGED_SMOKE_FIXTURE_INVALID' });
  });

  test('accepts only the exact bounded success DTO without secret-bearing extras', () => {
    const success = {
      format: 'omnidraw.preview-inspection-packaged-smoke-result.v1',
      ok: true,
      target: 'darwin-arm64',
      applicationVersion: '0.0.0-test',
      artifactDigestSha256: 'a'.repeat(64),
      capsuleArtifactHash: `sha256:${'b'.repeat(64)}`,
      screenshotDigestSha256: 'c'.repeat(64),
      screenshotBytes: 1_024,
      screenshotWidth: 640,
      screenshotHeight: 480,
      action: {
        type: 'click',
        status: 'passed',
        incrementObserved: true,
      },
    } as const;

    expect(parsePackagedSmokeSuccessDto(success)).toEqual(success);
    for (const field of ['path', 'token', 'bytesBase64'] as const) {
      expect(() => parsePackagedSmokeSuccessDto({
        ...success,
        [field]: 'must-not-cross-the-boundary',
      })).toThrow('invalid DTO');
      expect(() => parsePackagedSmokeSuccessDto({
        ...success,
        action: {
          ...success.action,
          [field]: 'must-not-cross-the-boundary',
        },
      })).toThrow('invalid DTO');
    }
    expect(() => parsePackagedSmokeSuccessDto({
      ...success,
      applicationVersion: 'v'.repeat(129),
    })).toThrow('invalid DTO');
    expect(() => parsePackagedSmokeSuccessDto({
      ...success,
      screenshotBytes: 8 * 1_024 * 1_024 + 1,
    })).toThrow('invalid DTO');
  });

  test('does not expose the internal smoke branch from a source invocation', async () => {
    const child = Bun.spawn([
      process.execPath,
      'run',
      join(import.meta.dir, '..', 'src', 'main.ts'),
      '--preview-inspection-packaged-smoke',
    ], {
      cwd: join(import.meta.dir, '..', '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toEqual({
      format: 'omnidraw.preview-inspection-packaged-smoke-result.v1',
      ok: false,
      code: 'PACKAGED_SMOKE_COMPILED_BINARY_REQUIRED',
    });

    const mainSource = await readFile(
      join(import.meta.dir, '..', 'src', 'main.ts'),
      'utf8',
    );
    expect(mainSource).toContain(
      'OMNIDRAW_PREVIEW_INSPECTION_PACKAGED_SMOKE',
    );
    expect(mainSource).not.toContain('OMNIDRAW_COMPILED');
  });
});
