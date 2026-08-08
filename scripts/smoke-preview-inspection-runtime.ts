#!/usr/bin/env bun

/**
 * @file Executes the staged darwin-arm64 Omnidraw CLI's internal qualification
 * path, then independently verifies its native action and widget PNG evidence.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  fnValidateBoundedPngBytes,
} from '../packages/shared-functions/src/image/fn.png-base64';

const RESULT_FORMAT = 'omnidraw.preview-inspection-packaged-smoke-result.v1';
const FIXTURE_FORMAT = 'omnidraw.preview-inspection-packaged-smoke-fixture.v1';
const MAXIMUM_STDIO_BYTES = 16 * 1_024;
const MAXIMUM_FIXTURE_BYTES = 1 * 1_024 * 1_024;
const MAXIMUM_SCREENSHOT_BYTES = 8 * 1_024 * 1_024;

export type TPackagedSmokeSuccessDto = Readonly<{
  format: typeof RESULT_FORMAT;
  ok: true;
  target: 'darwin-arm64';
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

function parseReleaseRoot(argv: readonly string[]): string {
  const inline = argv.find((argument) => argument.startsWith('--release-root='));
  if (inline !== undefined) return inline.slice('--release-root='.length);
  const index = argv.indexOf('--release-root');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value.length === 0) {
    throw new Error(
      'Usage: bun run scripts/smoke-preview-inspection-runtime.ts --release-root <packaged-release-directory>',
    );
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Packaged Preview inspection smoke returned an invalid DTO.');
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const observed = Object.keys(value).sort();
  return observed.length === expected.length
    && observed.every((key, index) => key === expected[index]);
}

function boundedString(
  value: unknown,
  expression: RegExp,
  maximumBytes: number,
): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') <= maximumBytes
    && expression.test(value);
}

export function parsePackagedSmokeSuccessDto(
  value: unknown,
): TPackagedSmokeSuccessDto {
  const result = record(value);
  const resultKeys = [
    'action',
    'applicationVersion',
    'artifactDigestSha256',
    'capsuleArtifactHash',
    'format',
    'ok',
    'screenshotBytes',
    'screenshotDigestSha256',
    'screenshotHeight',
    'screenshotWidth',
    'target',
  ] as const;
  if (!hasExactKeys(result, resultKeys)) {
    throw new Error('Packaged Preview inspection smoke returned an invalid DTO.');
  }
  const action = record(result.action);
  if (
    !hasExactKeys(action, ['incrementObserved', 'status', 'type'])
    || result.format !== RESULT_FORMAT
    || result.ok !== true
    || result.target !== 'darwin-arm64'
    || !boundedString(
      result.applicationVersion,
      /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,127}$/,
      128,
    )
    || !boundedString(result.artifactDigestSha256, /^[a-f0-9]{64}$/, 64)
    || !boundedString(result.capsuleArtifactHash, /^sha256:[a-f0-9]{64}$/, 71)
    || !boundedString(result.screenshotDigestSha256, /^[a-f0-9]{64}$/, 64)
    || !Number.isSafeInteger(result.screenshotBytes)
    || (result.screenshotBytes as number) < 1
    || (result.screenshotBytes as number) > MAXIMUM_SCREENSHOT_BYTES
    || result.screenshotWidth !== 640
    || result.screenshotHeight !== 480
    || action.type !== 'click'
    || action.status !== 'passed'
    || action.incrementObserved !== true
  ) {
    throw new Error('Packaged Preview inspection smoke returned an invalid DTO.');
  }
  return Object.freeze({
    format: RESULT_FORMAT,
    ok: true,
    target: 'darwin-arm64',
    applicationVersion: result.applicationVersion,
    artifactDigestSha256: result.artifactDigestSha256,
    capsuleArtifactHash: result.capsuleArtifactHash as `sha256:${string}`,
    screenshotDigestSha256: result.screenshotDigestSha256,
    screenshotBytes: result.screenshotBytes as number,
    screenshotWidth: 640,
    screenshotHeight: 480,
    action: Object.freeze({
      type: 'click',
      status: 'passed',
      incrementObserved: true,
    }),
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function executePackagedCli(
  executablePath: string,
  releaseRoot: string,
): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  return await new Promise((resolveExecution) => {
    execFile(
      executablePath,
      ['--preview-inspection-packaged-smoke'],
      {
        cwd: releaseRoot,
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'production' },
        maxBuffer: MAXIMUM_STDIO_BYTES,
        timeout: 180_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => resolveExecution(Object.freeze({
        exitCode: error === null
          ? 0
          : typeof error.code === 'number'
            ? error.code
            : 1,
        stdout,
        stderr,
      })),
    );
  });
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error(
      `Preview inspection packaged qualification supports only darwin-arm64; received ${process.platform}-${process.arch}.`,
    );
  }
  const releaseRoot = resolve(parseReleaseRoot(Bun.argv.slice(2)));
  const releaseRootInfo = await lstat(releaseRoot).catch(() => null);
  if (
    releaseRootInfo === null
    || !releaseRootInfo.isDirectory()
    || releaseRootInfo.isSymbolicLink()
  ) {
    throw new Error('Packaged Preview inspection release root is invalid.');
  }
  const executablePath = join(releaseRoot, 'bin', 'omnidraw');
  const qualificationRoot = join(
    releaseRoot,
    'share',
    'omnidraw',
    'preview-inspection',
    'qualification',
  );
  const fixturePath = join(qualificationRoot, 'signed-fixture.json');
  const resultPath = join(qualificationRoot, 'smoke-result.png');
  const executable = await lstat(executablePath).catch(() => null);
  const fixtureInfo = await lstat(fixturePath).catch(() => null);
  if (
    executable === null
    || !executable.isFile()
    || executable.isSymbolicLink()
    || fixtureInfo === null
    || !fixtureInfo.isFile()
    || fixtureInfo.isSymbolicLink()
    || fixtureInfo.size < 1
    || fixtureInfo.size > MAXIMUM_FIXTURE_BYTES
  ) throw new Error('Packaged Preview inspection inputs are missing or invalid.');
  if (await lstat(resultPath).catch(() => null) !== null) {
    throw new Error('Packaged Preview inspection result destination is stale.');
  }

  try {
    const execution = await executePackagedCli(executablePath, releaseRoot);
    if (Buffer.byteLength(execution.stdout, 'utf8') > MAXIMUM_STDIO_BYTES) {
      throw new Error('Packaged Preview inspection output exceeded its bound.');
    }
    let untrustedResult: Record<string, unknown>;
    try {
      untrustedResult = record(JSON.parse(execution.stdout.trim()) as unknown);
    } catch {
      throw new Error('Packaged Preview inspection smoke returned invalid JSON.');
    }
    if (
      execution.exitCode !== 0
      || execution.stderr.length !== 0
      || untrustedResult.ok !== true
    ) {
      const code = typeof untrustedResult.code === 'string'
        && /^[A-Z][A-Z0-9_]{0,127}$/.test(untrustedResult.code)
        ? untrustedResult.code
        : 'PACKAGED_SMOKE_FAILED';
      throw new Error(`Packaged Preview inspection CLI failed with ${code}.`);
    }
    const result = parsePackagedSmokeSuccessDto(untrustedResult);
    const action = result.action;
    const fixture = record(JSON.parse(await readFile(fixturePath, 'utf8')) as unknown);
    const artifact = record(fixture.artifact);
    if (
      fixture.format !== FIXTURE_FORMAT
      || result.format !== RESULT_FORMAT
      || result.target !== 'darwin-arm64'
      || result.artifactDigestSha256 !== artifact.digestSha256
      || result.capsuleArtifactHash !== artifact.capsuleArtifactHash
      || action.type !== 'click'
      || action.status !== 'passed'
      || action.incrementObserved !== true
    ) throw new Error('Packaged Preview inspection identity or action evidence is invalid.');

    const screenshotInfo = await lstat(resultPath).catch(() => null);
    if (
      screenshotInfo === null
      || !screenshotInfo.isFile()
      || screenshotInfo.isSymbolicLink()
      || screenshotInfo.size < 1
      || screenshotInfo.size > MAXIMUM_SCREENSHOT_BYTES
      || screenshotInfo.size !== result.screenshotBytes
    ) throw new Error('Packaged Preview inspection screenshot evidence is invalid.');
    const screenshot = new Uint8Array(await readFile(resultPath));
    const png = fnValidateBoundedPngBytes(screenshot);
    if (
      !png.ok
      || png.metadata.width !== 640
      || png.metadata.height !== 480
      || png.metadata.byteSize !== screenshot.byteLength
      || result.screenshotWidth !== png.metadata.width
      || result.screenshotHeight !== png.metadata.height
      || typeof result.screenshotDigestSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(result.screenshotDigestSha256)
      || sha256(screenshot) !== result.screenshotDigestSha256
    ) throw new Error('Packaged Preview inspection PNG identity is invalid.');
    process.stdout.write(
      `Packaged Omnidraw signed action/PNG smoke passed for darwin-arm64 (${result.screenshotDigestSha256}).\n`,
    );
  } finally {
    await rm(resultPath, { force: true });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Preview inspection packaged smoke failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
