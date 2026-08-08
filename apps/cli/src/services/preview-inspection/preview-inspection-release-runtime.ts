import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { PREVIEW_INSPECTION_BROWSER_RUNTIME } from './CONSTANTS';

type TPreviewInspectionReleaseRuntimeArgs = Readonly<{
  compiled: boolean;
  executablePath: string;
  sourceCliDir: string;
  platform: string;
  arch: string;
}>;

export type TPreviewInspectionReleaseRuntime = Readonly<{
  shellPath: string;
  releaseManifestRequired: boolean;
  expectedExecutableSha256?: string;
}>;

type TExpectedRuntime = typeof PREVIEW_INSPECTION_BROWSER_RUNTIME & Readonly<{
  browserRevision: string;
  browserVersion: string;
}>;

function targetFor(platform: string, arch: string): string | undefined {
  const target = `${platform}-${arch}`;
  if (target === 'darwin-arm64') return target;
  return undefined;
}

function readExpectedExecutableSha256(
  manifestPath: string,
  runtimeRoot: string,
  platform: string,
  arch: string,
): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const manifest = value as Record<string, unknown>;
  const runtimeValue = manifest.runtime;
  const shellValue = manifest.shell;
  if (
    manifest.format !== 'omnidraw.preview-inspection-release.v1'
    || manifest.target !== targetFor(platform, arch)
    || typeof runtimeValue !== 'object'
    || runtimeValue === null
    || Array.isArray(runtimeValue)
    || typeof shellValue !== 'object'
    || shellValue === null
    || Array.isArray(shellValue)
  ) return undefined;
  const runtime = runtimeValue as Record<string, unknown>;
  const shell = shellValue as Record<string, unknown>;
  const expected = PREVIEW_INSPECTION_BROWSER_RUNTIME as TExpectedRuntime;
  if (
    runtime.packageName !== expected.packageName
    || runtime.packageVersion !== expected.packageVersion
    || runtime.browserName !== expected.browserName
    || runtime.browserRevision !== expected.browserRevision
    || runtime.browserVersion !== expected.browserVersion
    || typeof runtime.executableSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(runtime.executableSha256)
  ) return undefined;

  if (
    shell.relativePath !== 'shell'
    || !Number.isSafeInteger(shell.totalBytes)
    || (shell.totalBytes as number) < 0
    || (shell.totalBytes as number) > 32 * 1_024 * 1_024
    || !Array.isArray(shell.files)
    || shell.files.length === 0
    || shell.files.length > 256
  ) return undefined;
  let observedTotalBytes = 0;
  let hasIndex = false;
  const seen = new Set<string>();
  for (const value of shell.files) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }
    const file = value as Record<string, unknown>;
    if (
      typeof file.path !== 'string'
      || !file.path.startsWith('shell/')
      || file.path.split('/').some((segment) =>
        segment.length === 0 || segment === '.' || segment === '..')
      || seen.has(file.path)
      || !Number.isSafeInteger(file.bytes)
      || (file.bytes as number) < 0
      || (file.bytes as number) > (shell.totalBytes as number)
      || typeof file.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(file.sha256)
    ) return undefined;
    seen.add(file.path);
    if (file.path === 'shell/index.html') hasIndex = true;
    const normalizedRuntimeRoot = resolve(runtimeRoot);
    const stagedPath = resolve(runtimeRoot, file.path);
    if (!stagedPath.startsWith(`${normalizedRuntimeRoot}${sep}`)) {
      return undefined;
    }
    try {
      const realRuntimeRoot = realpathSync(normalizedRuntimeRoot);
      const realStagedPath = realpathSync(stagedPath);
      if (!realStagedPath.startsWith(`${realRuntimeRoot}${sep}`)) return undefined;
      const info = lstatSync(stagedPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== file.bytes) {
        return undefined;
      }
      const digest = createHash('sha256').update(readFileSync(stagedPath)).digest('hex');
      if (digest !== file.sha256) return undefined;
    } catch {
      return undefined;
    }
    observedTotalBytes += file.bytes as number;
    if (observedTotalBytes > 32 * 1_024 * 1_024) return undefined;
  }
  if (!hasIndex || observedTotalBytes !== shell.totalBytes) return undefined;
  return runtime.executableSha256;
}

/**
 * Resolves source and compiled layouts without accepting an environment path.
 * A compiled runtime requires its staged target-specific checksum manifest;
 * invalid or absent evidence stays undefined for the service preflight to
 * report through a stable actionable failure code.
 */
export function resolvePreviewInspectionReleaseRuntime(
  args: TPreviewInspectionReleaseRuntimeArgs,
): TPreviewInspectionReleaseRuntime {
  if (!args.compiled) {
    return Object.freeze({
      shellPath: resolve(
        args.sourceCliDir,
        '..',
        '..',
        'preview-inspection-shell',
        'dist',
      ),
      releaseManifestRequired: false,
    });
  }

  const runtimeRoot = resolve(
    dirname(args.executablePath),
    '..',
    'share',
    'omnidraw',
    'preview-inspection',
  );
  const expectedExecutableSha256 = readExpectedExecutableSha256(
    join(runtimeRoot, 'runtime-manifest.json'),
    runtimeRoot,
    args.platform,
    args.arch,
  );
  return Object.freeze({
    shellPath: join(runtimeRoot, 'shell'),
    releaseManifestRequired: true,
    ...(expectedExecutableSha256 === undefined
      ? {}
      : { expectedExecutableSha256 }),
  });
}
