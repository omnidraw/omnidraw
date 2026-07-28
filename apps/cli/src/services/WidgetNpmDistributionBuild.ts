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
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnBootstrapWidgetUiEntry } from './fn.widget-ui-entry';

const DISTRIBUTION_ENTRY = 'main.js';
const DISTRIBUTION_DIRECTORY = 'dist';
const MAX_BUILD_OUTPUT_BYTES = 1024 * 1024;
const MAX_DISTRIBUTION_FILES = 1_024;
const MAX_DISTRIBUTION_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DISTRIBUTION_TOTAL_BYTES = 32 * 1024 * 1024;
const LOCAL_DEPENDENCY_DIRECTORY = '.vibecanvas-links';
const GUEST_BRIDGE_BOOTSTRAP = '__vibecanvas_guest_bridge__.mjs';
const GUEST_BRIDGE_BOOTSTRAP_SOURCE = [
  "import { subscribeHostLifecycle } from '@omnidraw/capsule/guest';",
  'subscribeHostLifecycle(() => undefined).unsubscribe();',
  '',
].join('\n');
const LOCAL_DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const);
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

type TPackageJson = Record<string, unknown> & Readonly<{
  scripts?: Readonly<{ build?: unknown }>;
}>;

function hash(value: Uint8Array | string): CapsuleHash {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function commandError(
  code: string,
  command: string,
  args: readonly string[],
  message: string,
  reason?: string,
): Error {
  return Object.assign(new Error(message), {
    diagnostic: Object.freeze({
      code,
      construct: [command, ...args].join(' '),
      ...(reason === undefined || reason === '' ? {} : { reason }),
    }),
  });
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

async function bootstrapWidgetUiEntry(root: string, entry: string): Promise<void> {
  assertProjectPath(entry);
  const path = join(root, ...entry.split('/'));
  const source = await readFile(path, 'utf8');
  const relativeBootstrapPath = posix.relative(posix.dirname(entry), GUEST_BRIDGE_BOOTSTRAP);
  const bootstrapSpecifier = relativeBootstrapPath.startsWith('.')
    ? relativeBootstrapPath
    : `./${relativeBootstrapPath}`;
  await writeFile(
    join(root, GUEST_BRIDGE_BOOTSTRAP),
    GUEST_BRIDGE_BOOTSTRAP_SOURCE,
    { flag: 'wx', mode: 0o600 },
  );
  await writeFile(
    path,
    fnBootstrapWidgetUiEntry(source, bootstrapSpecifier),
    { mode: 0o600 },
  );
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
        terminalError = commandError(
          'WIDGET_COMMAND_OUTPUT_LIMIT',
          command,
          args,
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
      const message = `Widget command '${command} ${args.join(' ')}' failed`
        + ` (${signal ? `signal ${signal}` : `exit ${String(code)}`}).`
        + (detail === '' ? '' : `\n${detail}`);
      finish(commandError(
        'WIDGET_COMMAND_FAILED',
        command,
        args,
        message,
        detail,
      ));
    });
    const timeout = setTimeout(() => {
      if (terminalError) return;
      terminalError = commandError(
        'WIDGET_COMMAND_TIMEOUT',
        command,
        args,
        `Widget command '${command} ${args.join(' ')}' timed out.`,
      );
      terminate();
    }, options.timeoutMs);
  });
}

function localDependencySource(root: string, specifier: string): string {
  if (specifier.startsWith('file://')) {
    try {
      return fileURLToPath(specifier);
    } catch {
      throw new Error(`Widget package.json contains invalid local dependency '${specifier}'.`);
    }
  }
  try {
    return resolve(root, decodeURIComponent(specifier.slice('file:'.length)));
  } catch {
    throw new Error(`Widget package.json contains invalid local dependency '${specifier}'.`);
  }
}

async function stageLocalDependencies(root: string): Promise<boolean> {
  const packagePath = join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as TPackageJson;
  const dependencies: Array<{
    section: typeof LOCAL_DEPENDENCY_SECTIONS[number];
    name: string;
    specifier: string;
  }> = [];
  for (const section of LOCAL_DEPENDENCY_SECTIONS) {
    const values = packageJson[section];
    if (values === null || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === 'string' && value.startsWith('file:')) {
        dependencies.push({ section, name, specifier: value });
      }
    }
  }
  if (dependencies.length === 0) return false;

  const stagedRoot = join(root, LOCAL_DEPENDENCY_DIRECTORY);
  await mkdir(stagedRoot, { recursive: true, mode: 0o700 });
  const stagedBySource = new Map<string, string>();
  const stagedRootDependencies = new Map<string, string>();
  const stagedPackages: Array<{
    source: string;
    destination: string;
    relativePath: string;
  }> = [];

  const stageSource = async (requestedSource: string, dependencyName: string): Promise<string> => {
    const source = await realpath(requestedSource);
    const existing = stagedBySource.get(source);
    if (existing !== undefined) return existing;
    const metadata = await lstat(source);
    if (!metadata.isDirectory()) {
      throw new Error(
        `Widget local dependency '${dependencyName}' must resolve to a package directory.`,
      );
    }
    if (source === root || root.startsWith(`${source}${sep}`)) {
      throw new Error(
        `Widget local dependency '${dependencyName}' cannot contain the build root.`,
      );
    }
    const relativePath = `${LOCAL_DEPENDENCY_DIRECTORY}/dependency-${stagedBySource.size}`;
    const destination = join(root, ...relativePath.split('/'));
    stagedBySource.set(source, relativePath);
    const sourcePackage = JSON.parse(
      await readFile(join(source, 'package.json'), 'utf8'),
    ) as { files?: unknown };
    const includedRoots = Array.isArray(sourcePackage.files)
      ? sourcePackage.files
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.split(/[/[*?{]/u, 1)[0]?.trim() ?? '')
          .filter((value) => value !== '' && value !== '.' && value !== '..')
      : null;
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      errorOnExist: true,
      force: false,
      filter: (candidate) => {
        const localPath = relative(source, candidate);
        if (localPath.split(sep).includes('node_modules')) return false;
        if (includedRoots === null || localPath === '' || localPath === 'package.json') {
          return true;
        }
        return includedRoots.some((included) => (
          localPath === included || localPath.startsWith(`${included}${sep}`)
        ));
      },
    });
    stagedPackages.push({ source, destination, relativePath });
    return relativePath;
  };

  for (const dependency of dependencies) {
    const stagedRelativePath = await stageSource(
      localDependencySource(root, dependency.specifier),
      dependency.name,
    );
    stagedRootDependencies.set(dependency.name, stagedRelativePath);
    const section = packageJson[dependency.section] as Record<string, unknown>;
    section[dependency.name] = `file:./${stagedRelativePath}`;
  }

  for (let index = 0; index < stagedPackages.length; index += 1) {
    const staged = stagedPackages[index]!;
    const stagedPackagePath = join(staged.destination, 'package.json');
    const stagedPackage = JSON.parse(
      await readFile(stagedPackagePath, 'utf8'),
    ) as TPackageJson;
    for (const sectionName of LOCAL_DEPENDENCY_SECTIONS) {
      const section = stagedPackage[sectionName];
      if (section === null || typeof section !== 'object' || Array.isArray(section)) continue;
      for (const [name, value] of Object.entries(section)) {
        if (typeof value !== 'string') continue;
        if (value.startsWith('workspace:')) {
          // npm did not install nested workspace metadata while this package was
          // an external symlink. Keep that behavior after staging it locally.
          delete (section as Record<string, unknown>)[name];
          continue;
        }
        if (!value.startsWith('file:')) continue;
        const nestedRelativePath = await stageSource(
          localDependencySource(staged.source, value),
          name,
        );
        const nestedDestination = join(root, ...nestedRelativePath.split('/'));
        const nestedSpecifier = relative(staged.destination, nestedDestination)
          .split(sep)
          .join('/');
        (section as Record<string, unknown>)[name] = (
          `file:${nestedSpecifier.startsWith('.') ? nestedSpecifier : `./${nestedSpecifier}`}`
        );
      }
    }
    await writeFile(stagedPackagePath, `${JSON.stringify(stagedPackage, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, {
    mode: 0o600,
  });
  const lockPath = join(root, 'package-lock.json');
  const packageLock = JSON.parse(await readFile(lockPath, 'utf8')) as {
    packages?: Record<string, Record<string, unknown>>;
  };
  const lockPackages = packageLock.packages;
  if (lockPackages === undefined || typeof lockPackages !== 'object') {
    throw new Error('Widget package-lock.json must contain a packages map.');
  }
  const rootLock = lockPackages[''];
  if (rootLock === undefined) {
    throw new Error('Widget package-lock.json must contain its root package entry.');
  }
  for (const sectionName of LOCAL_DEPENDENCY_SECTIONS) {
    const section = packageJson[sectionName];
    if (section === undefined) delete rootLock[sectionName];
    else rootLock[sectionName] = section;
  }
  for (const staged of stagedPackages) {
    const stagedManifest = JSON.parse(
      await readFile(join(staged.destination, 'package.json'), 'utf8'),
    ) as { name?: unknown };
    const oldKey = Object.keys(lockPackages).find((key) => (
      key !== ''
      && !key.startsWith('node_modules/')
      && (
        resolve(root, ...key.split('/')) === staged.source
        || (
          typeof stagedManifest.name === 'string'
          && lockPackages[key]?.name === stagedManifest.name
        )
      )
    ));
    if (oldKey !== undefined) {
      delete lockPackages[oldKey];
    }
    for (const [key, entry] of Object.entries(lockPackages)) {
      if (entry.link !== true || typeof entry.resolved !== 'string') continue;
      const resolvedSource = resolve(root, ...entry.resolved.split('/'));
      if (resolvedSource === staged.source) delete lockPackages[key];
    }
  }
  for (const name of stagedRootDependencies.keys()) {
    const linkEntry = lockPackages[`node_modules/${name}`];
    if (linkEntry?.link === true) delete lockPackages[`node_modules/${name}`];
  }
  await writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`, {
    mode: 0o600,
  });
  return true;
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
      await bootstrapWidgetUiEntry(root, request.entry);
      await readPackageContract(root);
      const stagedLocalDependencies = await stageLocalDependencies(root);
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
      if (stagedLocalDependencies) {
        await execute('npm', [
          'install',
          '--package-lock-only',
          '--ignore-scripts',
        ], {
          cwd: root,
          timeoutMs: config.installTimeoutMs ?? 120_000,
          maxOutputBytes: MAX_BUILD_OUTPUT_BYTES,
        });
      }
      const contract = await readPackageContract(root);
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
