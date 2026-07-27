import type {
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import type {
  CapsuleBuildInput,
  CapsuleHash,
} from '@omnidraw/capsule/protocol';
import type {
  TVibecanvasDistributionBuild,
  TVibecanvasDistributionBuildRequest,
} from '@vibecanvas/capsule-vibecanvas/builder';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';

const DISTRIBUTION_ENTRY = 'main.js';
const DISTRIBUTION_DIRECTORY = 'dist';
const MAX_BUILD_OUTPUT_BYTES = 1024 * 1024;
const MAX_DISTRIBUTION_FILES = 1_024;
const MAX_DISTRIBUTION_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DISTRIBUTION_TOTAL_BYTES = 32 * 1024 * 1024;
const PRODUCER_NAME = 'vibecanvas-npm-build';
const PRODUCER_VERSION = '1';
const BUILD_CONFIGURATION = Object.freeze({
  format: 'vibecanvas-npm-distribution-build-v1',
  install: Object.freeze(['npm', 'ci']),
  build: Object.freeze(['npm', 'run', 'build']),
  outputDirectory: DISTRIBUTION_DIRECTORY,
  entry: DISTRIBUTION_ENTRY,
  lockfileVersion: 3,
});

type TRunProcess = (
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }>,
) => Promise<string | void>;

type TConfig = Readonly<{
  scratchDirectory: string;
  runProcess?: TRunProcess;
  installTimeoutMs?: number;
  buildTimeoutMs?: number;
}>;

function hash(value: Uint8Array | string): CapsuleHash {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function assertProjectPath(path: string): void {
  if (
    path.length === 0
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`Widget source contains unsafe path '${path}'.`);
  }
}

async function materialize(
  root: string,
  files: readonly CapsuleSnapshotFile[],
): Promise<void> {
  const seen = new Set<string>();
  for (const file of files) {
    assertProjectPath(file.path);
    const folded = file.path.toLocaleLowerCase('en-US');
    if (seen.has(folded)) {
      throw new Error(`Widget source contains a duplicate or case-colliding path '${file.path}'.`);
    }
    seen.add(folded);
    const destination = join(root, ...file.path.split('/'));
    const resolved = resolve(destination);
    if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
      throw new Error(`Widget source path escapes its build root: '${file.path}'.`);
    }
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 });
  }
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
  }>,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputBytes = 0;
    let output = '';
    let settled = false;
    let terminalError: Error | undefined;
    const terminate = () => {
      if (process.platform !== 'win32' && child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
          return;
        } catch {
          // Fall back to the direct child when its process group already exited.
        }
      }
      child.kill('SIGKILL');
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolvePromise(output.trim());
    };
    const capture = (chunk: Buffer) => {
      if (terminalError) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        terminalError = new Error(
          `Widget build output exceeded ${options.maxOutputBytes} bytes.`,
        );
        terminate();
        return;
      }
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      terminalError ??= error;
    });
    child.once('close', (code, signal) => {
      if (terminalError) {
        finish(terminalError);
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      const detail = output.trim().slice(-4_000);
      finish(new Error(
        `Widget command '${command} ${args.join(' ')}' failed`
        + ` (${signal ? `signal ${signal}` : `exit ${String(code)}`}).`
        + (detail === '' ? '' : `\n${detail}`),
      ));
    });
    const timeout = setTimeout(() => {
      if (terminalError) return;
      terminalError = new Error(
        `Widget command '${command} ${args.join(' ')}' timed out.`,
      );
      terminate();
    }, options.timeoutMs);
  });
}

function parseNodeEnvironment(output: string | void): Readonly<{
  nodeVersion: string;
  platform: string;
  architecture: string;
}> {
  if (typeof output !== 'string') {
    return Object.freeze({
      nodeVersion: 'injected',
      platform: 'injected',
      architecture: 'injected',
    });
  }
  try {
    const value = JSON.parse(output) as {
      nodeVersion?: unknown;
      platform?: unknown;
      architecture?: unknown;
    };
    if (
      typeof value.nodeVersion === 'string'
      && value.nodeVersion.length > 0
      && value.nodeVersion.length <= 64
      && typeof value.platform === 'string'
      && value.platform.length > 0
      && value.platform.length <= 64
      && typeof value.architecture === 'string'
      && value.architecture.length > 0
      && value.architecture.length <= 64
    ) {
      return Object.freeze({
        nodeVersion: value.nodeVersion,
        platform: value.platform,
        architecture: value.architecture,
      });
    }
  } catch {
    // Fall through to a stable injected identity for test process ports.
  }
  return Object.freeze({
    nodeVersion: 'injected',
    platform: 'injected',
    architecture: 'injected',
  });
}

async function readPackageContract(root: string): Promise<Readonly<{
  lockBytes: Uint8Array;
  buildScript: string;
}>> {
  const [packageBytes, lockBytes] = await Promise.all([
    readFile(join(root, 'package.json')),
    readFile(join(root, 'package-lock.json')),
  ]);
  const packageJson = JSON.parse(packageBytes.toString('utf8')) as {
    scripts?: { build?: unknown };
  };
  const packageLock = JSON.parse(lockBytes.toString('utf8')) as {
    lockfileVersion?: unknown;
  };
  if (
    typeof packageJson.scripts?.build !== 'string'
    || packageJson.scripts.build.trim() === ''
  ) {
    throw new Error("Widget package.json must define a non-empty 'build' script.");
  }
  if (packageLock.lockfileVersion !== BUILD_CONFIGURATION.lockfileVersion) {
    throw new Error('Widget package-lock.json must use lockfileVersion 3.');
  }
  return Object.freeze({
    lockBytes: new Uint8Array(lockBytes),
    buildScript: packageJson.scripts.build,
  });
}

async function captureDistribution(root: string): Promise<readonly CapsuleSnapshotFile[]> {
  const distributionRoot = join(root, DISTRIBUTION_DIRECTORY);
  const files: CapsuleSnapshotFile[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      assertProjectPath(relativePath);
      const folded = relativePath.toLocaleLowerCase('en-US');
      if (seen.has(folded)) {
        throw new Error(`Widget distribution contains a case-colliding path '${relativePath}'.`);
      }
      seen.add(folded);
      const absolutePath = join(directory, entry.name);
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Widget distribution contains unsupported file '${relativePath}'.`);
      }
      if (metadata.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (metadata.size > MAX_DISTRIBUTION_FILE_BYTES) {
        throw new Error(`Widget distribution file '${relativePath}' is too large.`);
      }
      const bytes = new Uint8Array(await readFile(absolutePath));
      const afterRead = await lstat(absolutePath);
      if (
        metadata.size !== afterRead.size
        || metadata.mtimeMs !== afterRead.mtimeMs
        || metadata.ino !== afterRead.ino
      ) {
        throw new Error(`Widget distribution changed while '${relativePath}' was captured.`);
      }
      totalBytes += bytes.byteLength;
      if (
        files.length + 1 > MAX_DISTRIBUTION_FILES
        || totalBytes > MAX_DISTRIBUTION_TOTAL_BYTES
      ) {
        throw new Error('Widget distribution exceeds its file or byte limit.');
      }
      files.push(Object.freeze({ path: posix.normalize(relativePath), bytes }));
    }
  }

  await visit(distributionRoot, '');
  if (!files.some((file) => file.path === DISTRIBUTION_ENTRY)) {
    throw new Error(`Widget distribution must contain '${DISTRIBUTION_ENTRY}'.`);
  }
  return Object.freeze(files);
}

export function createWidgetNpmDistributionBuild(
  config: TConfig,
): TVibecanvasDistributionBuild {
  const execute = config.runProcess ?? runProcess;
  return async (
    request: TVibecanvasDistributionBuildRequest,
  ): Promise<CapsuleBuildInput> => {
    await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(join(config.scratchDirectory, 'npm-distribution-'));
    try {
      await materialize(root, request.files);
      const contract = await readPackageContract(root);
      const npmVersionOutput = await execute('npm', ['--version'], {
        cwd: root,
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
      });
      const npmVersionToken = typeof npmVersionOutput === 'string'
        ? npmVersionOutput.trim().split(/\s+/u)[0]?.slice(0, 64)
        : undefined;
      const npmVersion = npmVersionToken !== undefined && npmVersionToken !== ''
        ? npmVersionToken
        : 'injected';
      const nodeEnvironment = parseNodeEnvironment(await execute('node', [
        '-p',
        'JSON.stringify({nodeVersion:process.version,platform:process.platform,architecture:process.arch})',
      ], {
        cwd: root,
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
      }));
      const buildEnvironment = Object.freeze({
        nodeVersion: nodeEnvironment.nodeVersion,
        npmVersion,
        platform: nodeEnvironment.platform,
        architecture: nodeEnvironment.architecture,
      });
      await execute('npm', ['ci'], {
        cwd: root,
        timeoutMs: config.installTimeoutMs ?? 120_000,
        maxOutputBytes: MAX_BUILD_OUTPUT_BYTES,
      });
      await execute('npm', ['run', 'build'], {
        cwd: root,
        timeoutMs: config.buildTimeoutMs ?? 120_000,
        maxOutputBytes: MAX_BUILD_OUTPUT_BYTES,
      });
      const files = await captureDistribution(root);
      const cssRoots = files
        .map((file) => file.path)
        .filter((path) => path.endsWith('.css'));
      return Object.freeze({
        kind: 'external-distribution',
        snapshot: Object.freeze({ files }),
        entry: DISTRIBUTION_ENTRY,
        ...(cssRoots.length > 0 ? { cssRoots: Object.freeze(cssRoots) } : {}),
        producer: Object.freeze({
          name: PRODUCER_NAME,
          version: `${PRODUCER_VERSION}+npm.${npmVersion}`,
          digest: hash(JSON.stringify({
            producer: PRODUCER_NAME,
            version: PRODUCER_VERSION,
            configuration: BUILD_CONFIGURATION,
            environment: buildEnvironment,
          })),
        }),
        sourceRevision: request.sourceRevision,
        dependencyLockDigest: hash(contract.lockBytes),
        buildConfigurationDigest: hash(JSON.stringify({
          configuration: BUILD_CONFIGURATION,
          sourceEntry: request.entry,
          buildScript: contract.buildScript,
          environment: buildEnvironment,
        })),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };
}

export type {
  TConfig as TWidgetNpmDistributionBuildConfig,
  TRunProcess as TWidgetNpmDistributionBuildProcess,
};
