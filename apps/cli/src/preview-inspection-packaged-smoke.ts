/**
 * @file Compiled-only qualification entry for one hash-pinned signed Preview
 * inspection fixture and its native action/widget PNG evidence.
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
  lstat,
  mkdtemp,
  open,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TWidgetCapsuleHostConfiguration } from '@omnidraw/widget-contract';
import { fnDefaultWidgetPreviewInspectionTheme } from './services/fn.widget-preview-inspection';
import { PreviewInspectionBrowserService } from './services/preview-inspection/PreviewInspectionBrowserService';
import { PreviewInspectionShellServer } from './services/preview-inspection/PreviewInspectionShellServer';
import { PREVIEW_INSPECTION_LIMITS } from './services/preview-inspection/CONSTANTS';
import type {
  TPreviewInspectionBrowserJob,
} from './services/preview-inspection/interface';
import {
  resolvePreviewInspectionReleaseRuntime,
} from './services/preview-inspection/preview-inspection-release-runtime';

const MANIFEST_FORMAT = 'omnidraw.preview-inspection-release.v1';
const FIXTURE_FORMAT = 'omnidraw.preview-inspection-packaged-smoke-fixture.v1';
const RESULT_FORMAT = 'omnidraw.preview-inspection-packaged-smoke-result.v1';
const TARGET = 'darwin-arm64';
const FIXTURE_RELATIVE_PATH = 'qualification/signed-fixture.json';
const RESULT_RELATIVE_PATH = 'qualification/smoke-result.png';
const MAXIMUM_MANIFEST_BYTES = 1 * 1_024 * 1_024;
const MAXIMUM_FIXTURE_BYTES = 1 * 1_024 * 1_024;
const MAXIMUM_APPLICATION_BYTES = 512 * 1_024 * 1_024;

type TSigningKey = TWidgetCapsuleHostConfiguration['signingKeys'][number];

type TPackagedSmokeFixture = Readonly<{
  publicKeys: Readonly<{ preview: TSigningKey; release: TSigningKey }>;
  host: Omit<TWidgetCapsuleHostConfiguration, 'signingKeys'>;
  artifact: Readonly<{
    digestSha256: string;
    bytesBase64: string;
    capsuleArtifactHash: `sha256:${string}`;
    runtimeDescriptor: TPreviewInspectionBrowserJob['artifact']['runtimeDescriptor'];
    functionDescriptors: TPreviewInspectionBrowserJob['functionDescriptors'];
    browserFunctionDescriptorsDigestSha256: string;
  }>;
}>;

export type TPreviewInspectionPackagedSmokeRelease = Readonly<{
  applicationVersion: string;
  runtimeRoot: string;
  shellPath: string;
  expectedBrowserExecutableSha256: string;
  resultPath: string;
  fixture: TPackagedSmokeFixture;
}>;

type TPackagedSmokeSuccess = Readonly<{
  format: typeof RESULT_FORMAT;
  ok: true;
  target: typeof TARGET;
  applicationVersion: string;
  artifactDigestSha256: string;
  capsuleArtifactHash: `sha256:${string}`;
  screenshotDigestSha256: string;
  screenshotBytes: number;
  screenshotWidth: 640;
  screenshotHeight: 480;
  action: Readonly<{
    type: 'click';
    status: 'passed';
    incrementObserved: true;
  }>;
}>;

type TBoundedRegularFile = Readonly<{
  bytes: number;
  sha256: string;
  contents?: Buffer;
}>;

function smokeError(code: string): Error {
  return Object.assign(new Error('Packaged Preview inspection qualification failed.'), {
    code,
  });
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw smokeError(code);
  }
  return value as Record<string, unknown>;
}

function exactString(
  value: unknown,
  expression: RegExp,
  maximumBytes: number,
  code: string,
): string {
  if (
    typeof value !== 'string'
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || !expression.test(value)
  ) throw smokeError(code);
  return value;
}

async function boundedRegularFile(
  path: string,
  maximumBytes: number,
  code: string,
  includeContents = false,
): Promise<TBoundedRegularFile> {
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch {
    throw smokeError(code);
  }
  try {
    const before = await handle.stat();
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || !Number.isSafeInteger(before.size)
      || before.size < 1
      || before.size > maximumBytes
    ) throw smokeError(code);

    const contents = includeContents ? Buffer.alloc(before.size) : undefined;
    const reusable = contents ?? Buffer.allocUnsafe(Math.min(before.size, 64 * 1_024));
    const hash = createHash('sha256');
    let offset = 0;
    while (offset < before.size) {
      const destinationOffset = contents === undefined ? 0 : offset;
      const length = Math.min(
        reusable.byteLength - destinationOffset,
        before.size - offset,
      );
      const { bytesRead } = await handle.read(
        reusable,
        destinationOffset,
        length,
        offset,
      );
      if (bytesRead < 1) throw smokeError(code);
      hash.update(reusable.subarray(destinationOffset, destinationOffset + bytesRead));
      offset += bytesRead;
    }
    const trailing = Buffer.allocUnsafe(1);
    if ((await handle.read(trailing, 0, 1, before.size)).bytesRead !== 0) {
      throw smokeError(code);
    }
    const after = await handle.stat();
    if (!after.isFile() || after.size !== before.size) throw smokeError(code);
    return Object.freeze({
      bytes: before.size,
      sha256: hash.digest('hex'),
      ...(contents === undefined ? {} : { contents }),
    });
  } catch (error) {
    if (
      error instanceof Error
      && 'code' in error
      && error.code === code
    ) throw error;
    throw smokeError(code);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function boundedJson(
  path: string,
  maximumBytes: number,
  code: string,
): Promise<Readonly<{ value: unknown; evidence: TBoundedRegularFile }>> {
  const evidence = await boundedRegularFile(path, maximumBytes, code, true);
  try {
    return Object.freeze({
      value: JSON.parse(evidence.contents!.toString('utf8')) as unknown,
      evidence,
    });
  } catch {
    throw smokeError(code);
  }
}

function signingKey(value: unknown): TSigningKey {
  const key = record(value, 'PACKAGED_SMOKE_FIXTURE_INVALID');
  const keyId = exactString(
    key.keyId,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
    128,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  );
  const publicKeyBase64 = exactString(
    key.publicKeyBase64,
    /^[A-Za-z0-9+/]{43}=$/,
    44,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  );
  return Object.freeze({
    keyId,
    algorithm: key.algorithm === 'Ed25519'
      ? 'Ed25519'
      : (() => { throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID'); })(),
    format: key.format === 'raw'
      ? 'raw'
      : (() => { throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID'); })(),
    publicKeyBase64,
  });
}

function packagedFixture(value: unknown): TPackagedSmokeFixture {
  const root = record(value, 'PACKAGED_SMOKE_FIXTURE_INVALID');
  if (root.format !== FIXTURE_FORMAT) {
    throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID');
  }
  const publicKeys = record(root.publicKeys, 'PACKAGED_SMOKE_FIXTURE_INVALID');
  const host = record(root.host, 'PACKAGED_SMOKE_FIXTURE_INVALID');
  const artifact = record(root.artifact, 'PACKAGED_SMOKE_FIXTURE_INVALID');
  const bytesBase64 = exactString(
    artifact.bytesBase64,
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    Math.ceil(PREVIEW_INSPECTION_LIMITS.maximumArtifactBytes / 3) * 4,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  );
  const bytes = Buffer.from(bytesBase64, 'base64');
  if (
    bytes.byteLength < 1
    || bytes.byteLength > PREVIEW_INSPECTION_LIMITS.maximumArtifactBytes
    || bytes.toString('base64') !== bytesBase64
  ) throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID');
  const digestSha256 = exactString(
    artifact.digestSha256,
    /^[a-f0-9]{64}$/,
    64,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  );
  if (createHash('sha256').update(bytes).digest('hex') !== digestSha256) {
    throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID');
  }
  const capsuleArtifactHash = exactString(
    artifact.capsuleArtifactHash,
    /^sha256:[a-f0-9]{64}$/,
    71,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  ) as `sha256:${string}`;
  if (
    !Array.isArray(host.allowedApis)
    || host.allowedApis.length > 32
    || !Array.isArray(artifact.functionDescriptors)
  ) throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID');
  const runtimeDescriptor = record(
    artifact.runtimeDescriptor,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  ) as TPreviewInspectionBrowserJob['artifact']['runtimeDescriptor'];
  const browserFunctionDescriptorsDigestSha256 = exactString(
    artifact.browserFunctionDescriptorsDigestSha256,
    /^[a-f0-9]{64}$/,
    64,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  );
  return Object.freeze({
    publicKeys: Object.freeze({
      preview: signingKey(publicKeys.preview),
      release: signingKey(publicKeys.release),
    }),
    host: Object.freeze({
      generation: exactString(
        host.generation,
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
        128,
        'PACKAGED_SMOKE_FIXTURE_INVALID',
      ),
      allowedApis: Object.freeze([...host.allowedApis]) as TWidgetCapsuleHostConfiguration['allowedApis'],
      limits: Object.freeze(record(host.limits, 'PACKAGED_SMOKE_FIXTURE_INVALID')),
      previewSigningKeyId: exactString(
        host.previewSigningKeyId,
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
        128,
        'PACKAGED_SMOKE_FIXTURE_INVALID',
      ),
      releaseSigningKeyId: exactString(
        host.releaseSigningKeyId,
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
        128,
        'PACKAGED_SMOKE_FIXTURE_INVALID',
      ),
    }),
    artifact: Object.freeze({
      digestSha256,
      bytesBase64,
      capsuleArtifactHash,
      runtimeDescriptor,
      functionDescriptors: Object.freeze([...artifact.functionDescriptors]) as
        TPreviewInspectionBrowserJob['functionDescriptors'],
      browserFunctionDescriptorsDigestSha256,
    }),
  });
}

export async function readPreviewInspectionPackagedSmokeRelease(args: Readonly<{
  executablePath: string;
  platform: string;
  arch: string;
}>): Promise<TPreviewInspectionPackagedSmokeRelease> {
  if (`${args.platform}-${args.arch}` !== TARGET) {
    throw smokeError('PACKAGED_SMOKE_TARGET_UNSUPPORTED');
  }
  const runtimeRoot = resolve(
    dirname(args.executablePath),
    '..',
    'share',
    'omnidraw',
    'preview-inspection',
  );
  const manifestFile = await boundedJson(
    join(runtimeRoot, 'runtime-manifest.json'),
    MAXIMUM_MANIFEST_BYTES,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  const manifest = record(
    manifestFile.value,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  if (manifest.format !== MANIFEST_FORMAT || manifest.target !== TARGET) {
    throw smokeError('PACKAGED_SMOKE_MANIFEST_INVALID');
  }
  const application = record(manifest.application, 'PACKAGED_SMOKE_MANIFEST_INVALID');
  const qualification = record(
    manifest.qualification,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  const fixtureEvidence = record(
    qualification.fixture,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  const applicationVersion = exactString(
    application.version,
    /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/,
    128,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  const expectedApplicationSha256 = exactString(
    application.executableSha256,
    /^[a-f0-9]{64}$/,
    64,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  if (
    !Number.isSafeInteger(application.executableBytes)
    || (application.executableBytes as number) < 1
    || (application.executableBytes as number) > MAXIMUM_APPLICATION_BYTES
  ) throw smokeError('PACKAGED_SMOKE_MANIFEST_INVALID');
  const applicationEvidence = await boundedRegularFile(
    args.executablePath,
    MAXIMUM_APPLICATION_BYTES,
    'PACKAGED_SMOKE_APPLICATION_INVALID',
  );
  if (
    applicationEvidence.bytes !== application.executableBytes
    || applicationEvidence.sha256 !== expectedApplicationSha256
  ) throw smokeError('PACKAGED_SMOKE_APPLICATION_INVALID');

  if (
    fixtureEvidence.path !== FIXTURE_RELATIVE_PATH
    || !Number.isSafeInteger(fixtureEvidence.bytes)
    || (fixtureEvidence.bytes as number) < 1
    || (fixtureEvidence.bytes as number) > MAXIMUM_FIXTURE_BYTES
  ) throw smokeError('PACKAGED_SMOKE_MANIFEST_INVALID');
  const expectedFixtureSha256 = exactString(
    fixtureEvidence.sha256,
    /^[a-f0-9]{64}$/,
    64,
    'PACKAGED_SMOKE_MANIFEST_INVALID',
  );
  const fixturePath = join(runtimeRoot, FIXTURE_RELATIVE_PATH);
  const fixtureFile = await boundedJson(
    fixturePath,
    MAXIMUM_FIXTURE_BYTES,
    'PACKAGED_SMOKE_FIXTURE_INVALID',
  );
  if (
    fixtureFile.evidence.bytes !== fixtureEvidence.bytes
    || fixtureFile.evidence.sha256 !== expectedFixtureSha256
  ) throw smokeError('PACKAGED_SMOKE_FIXTURE_INVALID');
  const fixture = packagedFixture(fixtureFile.value);

  const runtime = resolvePreviewInspectionReleaseRuntime({
    compiled: true,
    executablePath: args.executablePath,
    sourceCliDir: '',
    platform: args.platform,
    arch: args.arch,
  });
  if (runtime.expectedExecutableSha256 === undefined) {
    throw smokeError('PACKAGED_SMOKE_MANIFEST_INVALID');
  }
  return Object.freeze({
    applicationVersion,
    runtimeRoot,
    shellPath: runtime.shellPath,
    expectedBrowserExecutableSha256: runtime.expectedExecutableSha256,
    resultPath: join(runtimeRoot, RESULT_RELATIVE_PATH),
    fixture,
  });
}

async function executePackagedSmoke(): Promise<TPackagedSmokeSuccess> {
  const release = await readPreviewInspectionPackagedSmokeRelease({
    executablePath: process.execPath,
    platform: process.platform,
    arch: process.arch,
  });
  if (await lstat(release.resultPath).catch(() => null) !== null) {
    throw smokeError('PACKAGED_SMOKE_RESULT_STALE');
  }
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'omnidraw-packaged-smoke-'));
  const shell = new PreviewInspectionShellServer({ distPath: release.shellPath });
  const service = new PreviewInspectionBrowserService({
    tempRoot: join(temporaryRoot, 'jobs'),
    shell,
    releaseManifestRequired: true,
    expectedExecutableSha256: release.expectedBrowserExecutableSha256,
  });
  let primaryError = false;
  try {
    const fixture = release.fixture;
    const bytes = Uint8Array.from(Buffer.from(fixture.artifact.bytesBase64, 'base64'));
    const result = await service.run(Object.freeze({
      format: 'omnidraw.preview-inspection-browser-job.v1',
      jobId: 'packaged-smoke-job',
      ownerKey: 'packaged-smoke-owner',
      widgetKey: 'preview-inspection-packaged-smoke',
      artifact: Object.freeze({
        bytes,
        digestSha256: fixture.artifact.digestSha256,
        capsuleArtifactHash: fixture.artifact.capsuleArtifactHash,
        runtimeDescriptor: fixture.artifact.runtimeDescriptor,
      }),
      hostConfiguration: Object.freeze({
        ...fixture.host,
        signingKeys: Object.freeze([
          fixture.publicKeys.preview,
          fixture.publicKeys.release,
        ]),
      }),
      functionDescriptors: fixture.artifact.functionDescriptors,
      browserFunctionDescriptorsDigestSha256:
        fixture.artifact.browserFunctionDescriptorsDigestSha256,
      functionBridge: Object.freeze({
        async invoke() {
          throw smokeError('PACKAGED_SMOKE_UNDECLARED_FUNCTION');
        },
        dispose() {},
      }),
      theme: fnDefaultWidgetPreviewInspectionTheme(),
      viewport: Object.freeze({ width: 640, height: 480, deviceScaleFactor: 1 }),
      settleFrames: 2,
      settleTimeoutMs: 5_000,
      actions: Object.freeze([Object.freeze({
        type: 'click' as const,
        target: Object.freeze({
          by: 'role' as const,
          role: 'button' as const,
          name: 'Increment',
          exact: true,
        }),
      })]),
      continueOnActionError: false,
      timeoutMs: 120_000,
      signal: new AbortController().signal,
    }));
    const action = result.actionResults[0];
    const incrementObserved = result.targets.some((target) => target.text === 'click:1');
    const screenshotDigestSha256 = createHash('sha256')
      .update(result.screenshotPng)
      .digest('hex');
    if (
      result.actionResults.length !== 1
      || action?.type !== 'click'
      || action.status !== 'passed'
      || !incrementObserved
      || result.artifactDigestSha256 !== fixture.artifact.digestSha256
      || result.capsuleArtifactHash !== fixture.artifact.capsuleArtifactHash
      || result.screenshotWidth !== 640
      || result.screenshotHeight !== 480
      || result.screenshotPng.byteLength < 1
      || result.screenshotPng.byteLength > PREVIEW_INSPECTION_LIMITS.maximumScreenshotBytes
      || screenshotDigestSha256 !== result.screenshotDigestSha256
    ) throw smokeError('PACKAGED_SMOKE_RESULT_INVALID');
    await writeFile(release.resultPath, result.screenshotPng, {
      flag: 'wx',
      mode: 0o600,
    });
    return Object.freeze({
      format: RESULT_FORMAT,
      ok: true,
      target: TARGET,
      applicationVersion: release.applicationVersion,
      artifactDigestSha256: result.artifactDigestSha256,
      capsuleArtifactHash: result.capsuleArtifactHash,
      screenshotDigestSha256,
      screenshotBytes: result.screenshotPng.byteLength,
      screenshotWidth: 640,
      screenshotHeight: 480,
      action: Object.freeze({
        type: 'click',
        status: 'passed',
        incrementObserved: true,
      }),
    });
  } catch (error) {
    primaryError = true;
    throw error;
  } finally {
    let cleanupFailed = false;
    try {
      await service.stop();
    } catch {
      cleanupFailed = true;
    }
    try {
      await rm(temporaryRoot, { recursive: true, force: true });
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed && !primaryError) {
      throw smokeError('PACKAGED_SMOKE_CLEANUP_FAILED');
    }
  }
}

function boundedErrorCode(error: unknown): string {
  if (
    error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
    && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.code)
  ) return error.code;
  return 'PACKAGED_SMOKE_FAILED';
}

export async function runPreviewInspectionPackagedSmokeCli(): Promise<void> {
  try {
    const result = await executePackagedSmoke();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(Object.freeze({
      format: RESULT_FORMAT,
      ok: false,
      code: boundedErrorCode(error),
    }))}\n`);
    process.exitCode = 1;
  }
}
