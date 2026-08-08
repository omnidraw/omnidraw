import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  previewInspectionReleaseTarget,
  stagePreviewInspectionRelease,
  type TPreviewInspectionReleaseExpectedRuntime,
  type TPreviewInspectionReleaseLicense,
} from './stage-preview-inspection-runtime';

const SHA256 = 'a'.repeat(64);
const expectedRuntime: TPreviewInspectionReleaseExpectedRuntime = Object.freeze({
  packageName: 'playwright',
  packageVersion: '1.61.1',
  browserName: 'chromium',
  browserRevision: '1228',
  browserVersion: '149.0.7827.55',
});

describe('Preview inspection compiled-release staging', () => {
  let root: string;
  let shellDist: string;
  let releaseRoot: string;
  let applicationExecutablePath: string;
  let qualificationFixtureSourcePath: string;
  let licenses: TPreviewInspectionReleaseLicense[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'omnidraw-inspection-release-'));
    shellDist = join(root, 'shell-dist');
    releaseRoot = join(root, 'release');
    applicationExecutablePath = join(root, 'omnidraw');
    qualificationFixtureSourcePath = join(root, 'fixtures.json');
    await mkdir(join(shellDist, 'assets'), { recursive: true });
    await writeFile(join(shellDist, 'index.html'), '<!doctype html><script src="/assets/main.js"></script>');
    await writeFile(join(shellDist, 'assets', 'main.js'), 'globalThis.shellReady = true;');
    await writeFile(applicationExecutablePath, 'compiled-omnidraw');
    await writeFile(qualificationFixtureSourcePath, JSON.stringify({
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
        wrong: { privateKeyBase64: 'must-not-stage' },
      },
      host: {
        generation: 'test-v1',
        allowedApis: ['DOM'],
        limits: {},
        previewSigningKeyId: 'preview',
        releaseSigningKeyId: 'release',
      },
      artifacts: {
        previewInspectionRunner: {
          digestSha256: 'b'.repeat(64),
          bytesBase64: 'dGVzdA==',
          capsuleArtifactHash: `sha256:${'c'.repeat(64)}`,
          runtimeDescriptor: { format: 'test' },
          functionDescriptors: [],
          browserFunctionDescriptorsDigestSha256: 'd'.repeat(64),
          diagnostics: 'must-not-stage',
        },
      },
    }));
    licenses = [];
    for (const packageName of ['playwright', 'playwright-core'] as const) {
      for (const fileName of ['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'] as const) {
        const sourcePath = join(root, `${packageName}-${fileName}`);
        await writeFile(sourcePath, `${packageName} ${fileName}\n`);
        licenses.push({ packageName, fileName, sourcePath });
      }
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('stages a bounded shell, license notices, and path-free runtime manifest', async () => {
    const manifest = await stagePreviewInspectionRelease({
      releaseRoot,
      shellDist,
      target: 'darwin-arm64',
      applicationExecutablePath,
      applicationVersion: '0.0.0-test',
      expectedRuntime,
      actualRuntime: {
        ...expectedRuntime,
        executablePath: '/private/cache/chromium-1228/secret/chrome',
        executableSha256: SHA256,
      },
      qualificationFixtureSourcePath,
      licenses,
    });
    const stagedRoot = join(releaseRoot, 'share', 'omnidraw', 'preview-inspection');
    const serialized = await readFile(join(stagedRoot, 'runtime-manifest.json'), 'utf8');

    expect(manifest.runtime).toMatchObject({
      packageVersion: '1.61.1',
      browserRevision: '1228',
      browserVersion: '149.0.7827.55',
      executableSha256: SHA256,
    });
    expect(manifest.application).toMatchObject({
      version: '0.0.0-test',
      executableBytes: 17,
    });
    expect(manifest.shell.files.map((file) => file.path)).toEqual([
      'shell/assets/main.js',
      'shell/index.html',
    ]);
    expect(manifest.licenses).toHaveLength(6);
    expect(manifest.qualification.fixture.path)
      .toBe('qualification/signed-fixture.json');
    expect(serialized).not.toContain('/private/cache');
    expect(serialized).not.toContain('secret');
    const fixture = await readFile(
      join(stagedRoot, 'qualification', 'signed-fixture.json'),
      'utf8',
    );
    expect(fixture).not.toContain('must-not-stage');
    expect(fixture).not.toContain('privateKeyBase64');
    expect(fixture)
      .toContain('omnidraw.preview-inspection-packaged-smoke-fixture.v1');
    expect(await readFile(join(stagedRoot, 'shell', 'index.html'), 'utf8'))
      .toContain('<!doctype html>');
  });

  test('rejects runtime drift and refuses to merge into a stale destination', async () => {
    const args = {
      releaseRoot,
      shellDist,
      target: 'darwin-arm64' as const,
      applicationExecutablePath,
      applicationVersion: '0.0.0-test',
      expectedRuntime,
      actualRuntime: {
        ...expectedRuntime,
        executablePath: '/cache/chromium-1228/chrome',
        executableSha256: SHA256,
      },
      qualificationFixtureSourcePath,
      licenses,
    };
    await expect(stagePreviewInspectionRelease({
      ...args,
      actualRuntime: { ...args.actualRuntime, browserRevision: '1229' },
    })).rejects.toThrow('does not match the release runtime pin');

    await stagePreviewInspectionRelease(args);
    await expect(stagePreviewInspectionRelease(args))
      .rejects.toThrow('release destination already exists');
  });

  test('never follows a symbolic-link input while staging exact file bytes', async () => {
    const linkedLicense = join(root, 'linked-license');
    await symlink(licenses[0]!.sourcePath, linkedLicense);

    await expect(stagePreviewInspectionRelease({
      releaseRoot,
      shellDist,
      target: 'darwin-arm64',
      applicationExecutablePath,
      applicationVersion: '0.0.0-test',
      expectedRuntime,
      actualRuntime: {
        ...expectedRuntime,
        executablePath: '/cache/chromium-1228/chrome',
        executableSha256: SHA256,
      },
      qualificationFixtureSourcePath,
      licenses: [
        { ...licenses[0]!, sourcePath: linkedLicense },
        ...licenses.slice(1),
      ],
    })).rejects.toThrow('must be a regular file');
  });

  test('uses an explicit supported target matrix', () => {
    expect(previewInspectionReleaseTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(previewInspectionReleaseTarget('darwin', 'x64')).toBeUndefined();
    expect(previewInspectionReleaseTarget('linux', 'x64')).toBeUndefined();
    expect(previewInspectionReleaseTarget('win32', 'x64')).toBeUndefined();
    expect(previewInspectionReleaseTarget('win32', 'arm64')).toBeUndefined();
    expect(previewInspectionReleaseTarget('freebsd', 'x64')).toBeUndefined();
  });
});
