import type { TOfflineCheckReport } from '@omnidraw/sdk/fn.offline-check';
import sdkPackage from '@omnidraw/sdk/package.json';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { refreshMutableRegistryPackageLock } from '../widget/refresh-mutable-registry-package-lock';

const MAX_CHECK_OUTPUT_BYTES = 1024 * 1024;
const INSTALL_TIMEOUT_MS = 120_000;
const CHECK_TIMEOUT_MS = 120_000;

type TSourceFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

type TRunProcess = (
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
    allowedExitCodes?: readonly number[];
  }>,
) => Promise<string>;

type TConfig = Readonly<{
  scratchDirectory: string;
  npmUserConfigPath: string;
  prepareNpmDependencies?: (signal?: AbortSignal) => Promise<void>;
  mutableRegistryUrl?: string;
  runProcess: TRunProcess;
}>;

export type TWidgetSdkSourceCheck = (args: Readonly<{
  files: readonly TSourceFile[];
  canonicalManifestJson: string;
  signal: AbortSignal;
}>) => Promise<TOfflineCheckReport>;

function sourceCheckError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function assertSourcePath(path: string): void {
  if (
    path.length === 0
    || path.length > 1_024
    || path.startsWith('/')
    || path.includes('\\')
    || path.includes('\0')
    || path === 'node_modules'
    || path.startsWith('node_modules/')
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) throw sourceCheckError('WIDGET_SOURCE_CHECK_INPUT_INVALID', 'Widget source check input contains an unsafe path.');
}

async function materializeSource(
  root: string,
  files: readonly TSourceFile[],
  canonicalManifestJson: string,
): Promise<void> {
  const inputs = [
    ...files,
    Object.freeze({
      path: 'omnidraw.json',
      bytes: new TextEncoder().encode(canonicalManifestJson),
    }),
  ];
  const seen = new Set<string>();
  for (const file of inputs) {
    assertSourcePath(file.path);
    const folded = file.path.toLocaleLowerCase('en-US');
    if (seen.has(folded)) {
      throw sourceCheckError('WIDGET_SOURCE_CHECK_INPUT_INVALID', 'Widget source check input contains a duplicate path.');
    }
    seen.add(folded);
    const destination = resolve(root, ...file.path.split('/'));
    if (!destination.startsWith(`${root}${sep}`)) {
      throw sourceCheckError('WIDGET_SOURCE_CHECK_INPUT_INVALID', 'Widget source check input escapes its workspace.');
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 });
  }
}

function isOfflineCheckReport(value: unknown): value is TOfflineCheckReport {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<TOfflineCheckReport>;
  return candidate.schemaVersion === 1
    && typeof candidate.ok === 'boolean'
    && candidate.scope === 'offline-project'
    && Array.isArray(candidate.checks)
    && candidate.checks.every((check) => (
      check !== null
      && typeof check === 'object'
      && typeof check.code === 'string'
      && typeof check.summary === 'string'
      && check.location !== null
      && typeof check.location === 'object'
      && typeof check.location.file === 'string'
      && (check.location.line === undefined || Number.isSafeInteger(check.location.line))
      && (check.location.column === undefined || Number.isSafeInteger(check.location.column))
    ))
    && Array.isArray(candidate.limitations)
    && typeof candidate.truncated === 'boolean';
}

/** Checks one immutable capture with the current SDK after isolated dependency preparation. */
export function createWidgetSdkSourceCheck(config: TConfig): TWidgetSdkSourceCheck {
  return async (args) => {
    if (args.signal.aborted) {
      throw sourceCheckError('ABORT_ERR', 'Widget source validation was cancelled.');
    }
    await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(join(config.scratchDirectory, 'source-check-'));
    const projectRoot = join(root, 'project');
    const toolchainRoot = join(root, 'toolchain');
    try {
      await mkdir(projectRoot, { recursive: false, mode: 0o700 });
      await mkdir(toolchainRoot, { recursive: false, mode: 0o700 });
      await materializeSource(projectRoot, args.files, args.canonicalManifestJson);
      await writeFile(join(toolchainRoot, 'package.json'), JSON.stringify({
        name: 'omnidraw-host-widget-source-check',
        private: true,
      }), { flag: 'wx', mode: 0o600 });
      if (config.mutableRegistryUrl !== undefined) {
        await refreshMutableRegistryPackageLock({ join, readFile, writeFile }, {
          root: projectRoot,
          registryUrl: config.mutableRegistryUrl,
        });
      }
      await config.prepareNpmDependencies?.(args.signal);
      await config.runProcess('npm', [
        'ci',
        '--ignore-scripts',
        '--userconfig',
        config.npmUserConfigPath,
      ], {
        cwd: projectRoot,
        timeoutMs: INSTALL_TIMEOUT_MS,
        maxOutputBytes: MAX_CHECK_OUTPUT_BYTES,
        signal: args.signal,
      });
      await config.runProcess('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--userconfig',
        config.npmUserConfigPath,
        `@omnidraw/sdk@${sdkPackage.version}`,
      ], {
        cwd: toolchainRoot,
        timeoutMs: INSTALL_TIMEOUT_MS,
        maxOutputBytes: MAX_CHECK_OUTPUT_BYTES,
        signal: args.signal,
      });
      const sdkCliPath = join(
        toolchainRoot,
        'node_modules',
        '@omnidraw',
        'sdk',
        'cli.js',
      );
      const output = await config.runProcess(process.execPath, [
        sdkCliPath,
        'check',
        '.',
        '--json',
      ], {
        cwd: projectRoot,
        timeoutMs: CHECK_TIMEOUT_MS,
        maxOutputBytes: MAX_CHECK_OUTPUT_BYTES,
        signal: args.signal,
        allowedExitCodes: [0, 3],
      });
      try {
        const parsed: unknown = JSON.parse(output);
        if (!isOfflineCheckReport(parsed)) {
          throw new Error('Current SDK source checker returned an invalid report.');
        }
        return parsed;
      } catch (error) {
        throw sourceCheckError(
          'WIDGET_SOURCE_CHECK_INVALID',
          error instanceof Error ? error.message : 'Current SDK source checker returned invalid JSON.',
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
}
