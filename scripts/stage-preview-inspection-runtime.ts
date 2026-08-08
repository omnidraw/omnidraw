#!/usr/bin/env bun

/**
 * @file Stages the internal inspection shell, runtime identity evidence, and
 * license notices into one compiled-release directory. It never downloads a
 * browser; release builders must provision the pinned Playwright browser first.
 */

import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_INSPECTION_BROWSER_RUNTIME,
} from '../apps/cli/src/services/preview-inspection/CONSTANTS';
import {
  readPlaywrightRuntimeIdentity,
  type TPlaywrightRuntimeIdentity,
} from '../apps/cli/src/services/preview-inspection/playwright-runtime-identity';

const MAXIMUM_SHELL_FILES = 256;
const MAXIMUM_SHELL_BYTES = 32 * 1_024 * 1_024;
const MAXIMUM_APPLICATION_BYTES = 512 * 1_024 * 1_024;
const MAXIMUM_FIXTURE_SOURCE_BYTES = 16 * 1_024 * 1_024;
const MAXIMUM_STAGED_FIXTURE_BYTES = 1 * 1_024 * 1_024;
const RELEASE_DIRECTORY_NAME = 'preview-inspection';
const QUALIFICATION_FIXTURE_PATH = 'qualification/signed-fixture.json';

export type TPreviewInspectionReleaseTarget = 'darwin-arm64';

export type TPreviewInspectionReleaseExpectedRuntime = Readonly<{
  packageName: string;
  packageVersion: string;
  browserName: 'chromium';
  browserRevision: string;
  browserVersion: string;
}>;

export type TPreviewInspectionReleaseLicense = Readonly<{
  packageName: 'playwright' | 'playwright-core';
  fileName: 'LICENSE' | 'NOTICE' | 'ThirdPartyNotices.txt';
  sourcePath: string;
}>;

type TStagedFile = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

export type TPreviewInspectionReleaseManifest = Readonly<{
  format: 'omnidraw.preview-inspection-release.v1';
  target: TPreviewInspectionReleaseTarget;
  application: Readonly<{
    version: string;
    executableSha256: string;
    executableBytes: number;
  }>;
  runtime: Readonly<{
    packageName: string;
    packageVersion: string;
    browserName: 'chromium';
    browserRevision: string;
    browserVersion: string;
    executableSha256: string;
    provisionCommand: string;
  }>;
  shell: Readonly<{
    relativePath: 'shell';
    totalBytes: number;
    files: readonly TStagedFile[];
  }>;
  qualification: Readonly<{
    fixture: TStagedFile;
  }>;
  licenses: readonly TStagedFile[];
}>;

type TStagePreviewInspectionReleaseArgs = Readonly<{
  releaseRoot: string;
  shellDist: string;
  target: TPreviewInspectionReleaseTarget;
  applicationExecutablePath: string;
  applicationVersion: string;
  expectedRuntime: TPreviewInspectionReleaseExpectedRuntime;
  actualRuntime: TPlaywrightRuntimeIdentity;
  qualificationFixtureSourcePath: string;
  licenses: readonly TPreviewInspectionReleaseLicense[];
}>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function boundedFileEvidence(
  path: string,
  maximumBytes: number,
): Promise<Readonly<{ bytes: number; sha256: string }>> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > maximumBytes) {
    throw new Error('Preview inspection release input is not a bounded regular file.');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return Object.freeze({ bytes: info.size, sha256: hash.digest('hex') });
}

function portableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function collectShellFiles(
  root: string,
  current: string,
  files: string[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error('Preview inspection shell staging rejects symbolic links.');
    }
    if (info.isDirectory()) {
      await collectShellFiles(root, path, files);
      continue;
    }
    if (!info.isFile()) {
      throw new Error('Preview inspection shell staging accepts only regular files.');
    }
    files.push(portableRelativePath(root, path));
    if (files.length > MAXIMUM_SHELL_FILES) {
      throw new Error('Preview inspection shell exceeds the staged file limit.');
    }
  }
}

function assertRuntimeIdentity(
  expected: TPreviewInspectionReleaseExpectedRuntime,
  actual: TPlaywrightRuntimeIdentity,
): void {
  if (
    actual.packageVersion !== expected.packageVersion
    || actual.browserName !== expected.browserName
    || actual.browserRevision !== expected.browserRevision
    || actual.browserVersion !== expected.browserVersion
  ) {
    throw new Error('Installed Playwright Chromium does not match the release runtime pin.');
  }
}

async function stageFile(
  source: string,
  destination: string,
  manifestPath: string,
): Promise<TStagedFile> {
  let handle;
  try {
    handle = await open(
      source,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch {
    throw new Error('Preview inspection release input must be a regular file.');
  }
  let bytes: Buffer;
  try {
    const before = await handle.stat();
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || !Number.isSafeInteger(before.size)
      || before.size < 0
      || before.size > MAXIMUM_SHELL_BYTES
    ) {
      throw new Error('Preview inspection release input must be a bounded regular file.');
    }
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        before.size - offset,
        offset,
      );
      if (bytesRead < 1) {
        throw new Error('Preview inspection release input changed while it was staged.');
      }
      offset += bytesRead;
    }
    const trailing = Buffer.allocUnsafe(1);
    if ((await handle.read(trailing, 0, 1, before.size)).bytesRead !== 0) {
      throw new Error('Preview inspection release input changed while it was staged.');
    }
    const after = await handle.stat();
    if (!after.isFile() || after.size !== before.size) {
      throw new Error('Preview inspection release input changed while it was staged.');
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: 'wx', mode: 0o644 });
  return Object.freeze({
    path: manifestPath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

export function previewInspectionReleaseTarget(
  platform: string,
  arch: string,
): TPreviewInspectionReleaseTarget | undefined {
  const candidate = `${platform}-${arch}`;
  if (candidate === 'darwin-arm64') return candidate;
  return undefined;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Preview inspection ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function qualificationKey(value: unknown): Readonly<Record<string, unknown>> {
  const key = record(value, 'qualification signing key');
  return Object.freeze({
    keyId: key.keyId,
    algorithm: key.algorithm,
    format: key.format,
    publicKeyBase64: key.publicKeyBase64,
  });
}

function qualificationFixture(source: unknown): Readonly<Record<string, unknown>> {
  const fixture = record(source, 'qualification fixture');
  const publicKeys = record(fixture.publicKeys, 'qualification public keys');
  const host = record(fixture.host, 'qualification host');
  const artifacts = record(fixture.artifacts, 'qualification artifacts');
  const artifact = record(
    artifacts.previewInspectionRunner,
    'qualification signed artifact',
  );
  return Object.freeze({
    format: 'omnidraw.preview-inspection-packaged-smoke-fixture.v1',
    publicKeys: Object.freeze({
      preview: qualificationKey(publicKeys.preview),
      release: qualificationKey(publicKeys.release),
    }),
    host: Object.freeze({
      generation: host.generation,
      allowedApis: host.allowedApis,
      limits: host.limits,
      previewSigningKeyId: host.previewSigningKeyId,
      releaseSigningKeyId: host.releaseSigningKeyId,
    }),
    artifact: Object.freeze({
      digestSha256: artifact.digestSha256,
      bytesBase64: artifact.bytesBase64,
      capsuleArtifactHash: artifact.capsuleArtifactHash,
      runtimeDescriptor: artifact.runtimeDescriptor,
      functionDescriptors: artifact.functionDescriptors,
      browserFunctionDescriptorsDigestSha256:
        artifact.browserFunctionDescriptorsDigestSha256,
    }),
  });
}

async function stageQualificationFixture(
  sourcePath: string,
  destinationRoot: string,
): Promise<TStagedFile> {
  await boundedFileEvidence(
    sourcePath,
    MAXIMUM_FIXTURE_SOURCE_BYTES,
  );
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown;
  const serialized = `${JSON.stringify(qualificationFixture(source), null, 2)}\n`;
  const bytes = Buffer.from(serialized, 'utf8');
  if (bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_STAGED_FIXTURE_BYTES) {
    throw new Error('Preview inspection qualification fixture exceeds its staged byte limit.');
  }
  const destination = join(destinationRoot, QUALIFICATION_FIXTURE_PATH);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { mode: 0o644 });
  return Object.freeze({
    path: QUALIFICATION_FIXTURE_PATH,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  });
}

/**
 * Creates `share/omnidraw/preview-inspection` transactionally. The generated
 * manifest contains no host path and pins the executable checksum observed by
 * the release builder for the target it is packaging.
 */
export async function stagePreviewInspectionRelease(
  args: TStagePreviewInspectionReleaseArgs,
): Promise<TPreviewInspectionReleaseManifest> {
  assertRuntimeIdentity(args.expectedRuntime, args.actualRuntime);
  if (!/^[a-f0-9]{64}$/.test(args.actualRuntime.executableSha256)) {
    throw new Error('Installed Playwright Chromium checksum is invalid.');
  }
  if (args.target !== 'darwin-arm64') {
    throw new Error('Preview inspection packaged qualification supports only darwin-arm64.');
  }
  if (args.applicationVersion.length < 1 || args.applicationVersion.length > 128) {
    throw new Error('Preview inspection application version is invalid.');
  }
  const application = await boundedFileEvidence(
    args.applicationExecutablePath,
    MAXIMUM_APPLICATION_BYTES,
  );
  const shellEntry = await lstat(join(args.shellDist, 'index.html')).catch(() => null);
  if (shellEntry === null || !shellEntry.isFile() || shellEntry.isSymbolicLink()) {
    throw new Error('Preview inspection shell build is missing index.html.');
  }

  const shellPaths: string[] = [];
  await collectShellFiles(args.shellDist, args.shellDist, shellPaths);
  const omnidrawShare = join(resolve(args.releaseRoot), 'share', 'omnidraw');
  const destination = join(omnidrawShare, RELEASE_DIRECTORY_NAME);
  if (await lstat(destination).catch(() => null) !== null) {
    throw new Error('Preview inspection release destination already exists.');
  }
  await mkdir(omnidrawShare, { recursive: true });
  const temporary = await mkdtemp(join(omnidrawShare, '.preview-inspection-'));

  try {
    const shellFiles: TStagedFile[] = [];
    let totalBytes = 0;
    for (const path of shellPaths) {
      const staged = await stageFile(
        join(args.shellDist, path),
        join(temporary, 'shell', path),
        `shell/${path}`,
      );
      totalBytes += staged.bytes;
      if (totalBytes > MAXIMUM_SHELL_BYTES) {
        throw new Error('Preview inspection shell exceeds the staged byte limit.');
      }
      shellFiles.push(staged);
    }

    const qualificationFixture = await stageQualificationFixture(
      args.qualificationFixtureSourcePath,
      temporary,
    );

    const licenseFiles: TStagedFile[] = [];
    const seenLicenses = new Set<string>();
    for (const license of args.licenses) {
      const manifestPath = `licenses/${license.packageName}/${license.fileName}`;
      if (seenLicenses.has(manifestPath)) {
        throw new Error('Preview inspection release contains a duplicate license file.');
      }
      seenLicenses.add(manifestPath);
      licenseFiles.push(await stageFile(
        license.sourcePath,
        join(temporary, manifestPath),
        manifestPath,
      ));
    }
    licenseFiles.sort((left, right) => left.path.localeCompare(right.path));

    const manifest: TPreviewInspectionReleaseManifest = Object.freeze({
      format: 'omnidraw.preview-inspection-release.v1',
      target: args.target,
      application: Object.freeze({
        version: args.applicationVersion,
        executableSha256: application.sha256,
        executableBytes: application.bytes,
      }),
      runtime: Object.freeze({
        packageName: args.expectedRuntime.packageName,
        packageVersion: args.expectedRuntime.packageVersion,
        browserName: args.expectedRuntime.browserName,
        browserRevision: args.expectedRuntime.browserRevision,
        browserVersion: args.expectedRuntime.browserVersion,
        executableSha256: args.actualRuntime.executableSha256,
        provisionCommand: `bun --cwd apps/cli x playwright@${args.expectedRuntime.packageVersion} install chromium`,
      }),
      shell: Object.freeze({
        relativePath: 'shell',
        totalBytes,
        files: Object.freeze(shellFiles),
      }),
      qualification: Object.freeze({ fixture: qualificationFixture }),
      licenses: Object.freeze(licenseFiles),
    });
    await writeFile(
      join(temporary, 'runtime-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o644 },
    );
    await rename(temporary, destination);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function stagePreviewInspectionReleaseFromWorkspace(args: Readonly<{
  releaseRoot: string;
  applicationVersion: string;
}>): Promise<TPreviewInspectionReleaseManifest> {
  const root = resolve(import.meta.dir, '..');
  const target = previewInspectionReleaseTarget(process.platform, process.arch);
  if (target === undefined) {
    throw new Error(`Preview inspection release staging does not support ${process.platform}-${process.arch}.`);
  }
  const cliRequire = createRequire(join(root, 'apps', 'cli', 'package.json'));
  const playwrightPackagePath = cliRequire.resolve('playwright/package.json');
  const playwrightRequire = createRequire(playwrightPackagePath);
  const packageRoot = (packageName: 'playwright' | 'playwright-core'): string =>
    dirname((packageName === 'playwright' ? cliRequire : playwrightRequire)
      .resolve(`${packageName}/package.json`));
  const licenses = (['playwright', 'playwright-core'] as const).flatMap((packageName) =>
    (['LICENSE', 'NOTICE', 'ThirdPartyNotices.txt'] as const).map((fileName) => ({
      packageName,
      fileName,
      sourcePath: join(packageRoot(packageName), fileName),
    }))
  );
  const expectedRuntime = PREVIEW_INSPECTION_BROWSER_RUNTIME as
    typeof PREVIEW_INSPECTION_BROWSER_RUNTIME & Readonly<{
      browserRevision: string;
      browserVersion: string;
    }>;
  const releaseRoot = resolve(args.releaseRoot);
  return await stagePreviewInspectionRelease({
    releaseRoot,
    shellDist: join(root, 'apps', 'preview-inspection-shell', 'dist'),
    target,
    applicationExecutablePath: join(releaseRoot, 'bin', 'omnidraw'),
    applicationVersion: args.applicationVersion,
    expectedRuntime,
    actualRuntime: await readPlaywrightRuntimeIdentity(),
    qualificationFixtureSourcePath: join(
      root,
      'apps',
      'capsule-browser-acceptance',
      'generated',
      'fixtures.json',
    ),
    licenses,
  });
}

function parseReleaseRoot(argv: readonly string[]): string {
  const inline = argv.find((argument) => argument.startsWith('--release-root='));
  if (inline !== undefined) return inline.slice('--release-root='.length);
  const index = argv.indexOf('--release-root');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined || value.length === 0) {
    throw new Error('Usage: bun run scripts/stage-preview-inspection-runtime.ts --release-root <compiled-release-directory>');
  }
  return value;
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDir, '..');
  const releaseRoot = resolve(root, parseReleaseRoot(Bun.argv.slice(2)));
  const manifest = await stagePreviewInspectionReleaseFromWorkspace({
    releaseRoot,
    applicationVersion: '0.0.0-a117-packaged-smoke',
  });
  process.stdout.write(
    `Staged ${manifest.shell.files.length} Preview inspection shell files and one signed fixture for ${manifest.target}.\n`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error
      ? error.message
      : typeof error === 'object'
        && error !== null
        && 'message' in error
        && typeof error.message === 'string'
        ? error.message
        : 'Preview inspection release staging failed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
