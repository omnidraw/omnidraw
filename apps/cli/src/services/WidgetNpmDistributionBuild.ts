import type {
  CapsuleSnapshotFile,
} from '@omnidraw/capsule/build';
import type {
  CapsuleBuildInput,
  CapsuleHash,
} from '@omnidraw/capsule/protocol';
import type {
  TOmnidrawDistributionBuild,
  TOmnidrawDistributionBuildRequest,
  TOmnidrawDistributionSourceMap,
} from '@omnidraw/capsule-omnidraw/builder';
import { createHash, randomUUID } from 'node:crypto';
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
import {
  dirname,
  isAbsolute,
  join,
  posix,
  resolve,
  sep,
} from 'node:path';
import {
  WIDGET_BUILD_RECEIPT_PATH,
  WIDGET_MANIFEST_V1_SCHEMA_URL,
  type TWidgetExecutableManifestProjection,
} from '@omnidraw/widget-contract';
import {
  fnBoundedBuildOutput,
  fnRedactBuildOutput,
  fnWidgetBuildProcessEnvironment,
} from './fn.redact-build-output';
import { fnBootstrapWidgetUiEntry } from './fn.widget-ui-entry';
import { txRefreshMutableRegistryPackageLock } from './tx.mutable-registry-package-lock';
import { txTerminateWidgetBuildProcessTree } from './tx.terminate-widget-build-process-tree';

const DISTRIBUTION_ENTRY = 'main.js';
const DISTRIBUTION_DIRECTORY = 'dist';
const MAX_BUILD_OUTPUT_BYTES = 1024 * 1024;
const MAX_DISTRIBUTION_FILES = 1_024;
const MAX_DISTRIBUTION_FILE_BYTES = 4 * 1024 * 1024;
const MAX_DISTRIBUTION_TOTAL_BYTES = 32 * 1024 * 1024;
const GUEST_BRIDGE_BOOTSTRAP = '__omnidraw_guest_bridge__.mjs';
const GUEST_BRIDGE_BOOTSTRAP_SOURCE = [
  "import { subscribeHostLifecycle } from '@omnidraw/capsule/guest';",
  'subscribeHostLifecycle(() => undefined).unsubscribe();',
  '',
].join('\n');
const DEPENDENCY_SECTIONS = Object.freeze([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const);
const PRODUCER_NAME = 'omnidraw-npm-build';
const PRODUCER_VERSION = '1';
const HOST_RUNNER_IDENTITY = 'host-v1';
const DOCKER_RUNNER_VERSION = 'docker-v1';
const DOCKER_WORKSPACE_PATH = '/workspace';
const DOCKER_NPM_USER_CONFIG_PATH = '/run/omnidraw-npmrc';
const DOCKER_HOME_PATH = '/tmp/omnidraw-home';
const DOCKER_NPM_CACHE_PATH = '/tmp/omnidraw-npm-cache';
const DOCKER_TMPFS_BYTES = 512 * 1024 * 1024;
const DOCKER_DEFAULT_CPUS = 2;
const DOCKER_DEFAULT_MEMORY_MB = 2_048;
const DOCKER_DEFAULT_PIDS_LIMIT = 128;
const DOCKER_CONTROL_TIMEOUT_MS = 10_000;
const DOCKER_CONTROL_OUTPUT_BYTES = 16 * 1024;
const DOCKER_CLEANUP_ATTEMPTS = 3;
const DOCKER_IMAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:~-]*@sha256:[a-f0-9]{64}$/u;
const RUNNER_IDENTITY_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$/u;
const WIDGET_BUILD_RUNNER_ENV = 'OMNIDRAW_WIDGET_BUILD_RUNNER';
const WIDGET_BUILD_DOCKER_IMAGE_ENV = 'OMNIDRAW_WIDGET_BUILD_DOCKER_IMAGE';
const WIDGET_BUILD_DOCKER_CPUS_ENV = 'OMNIDRAW_WIDGET_BUILD_DOCKER_CPUS';
const WIDGET_BUILD_DOCKER_MEMORY_MB_ENV = 'OMNIDRAW_WIDGET_BUILD_DOCKER_MEMORY_MB';
const WIDGET_BUILD_DOCKER_PIDS_LIMIT_ENV = 'OMNIDRAW_WIDGET_BUILD_DOCKER_PIDS_LIMIT';
const NODE_ENVIRONMENT_EXPRESSION =
  'JSON.stringify({nodeVersion:process.version,platform:process.platform,architecture:process.arch})';
const BUILD_CONFIGURATION = Object.freeze({
  format: 'omnidraw-npm-distribution-build-v1',
  install: Object.freeze(['npm', 'ci']),
  build: Object.freeze(['npm', 'run', 'build']),
  outputDirectory: DISTRIBUTION_DIRECTORY,
  entry: DISTRIBUTION_ENTRY,
  lockfileVersion: 3,
});
const WIDGET_UI_ENTRY_TRANSFORM_PROBES = Object.freeze([
  Object.freeze({
    source: 'export const probe = true;\n',
    bootstrapSpecifier: './__omnidraw_guest_bridge__.mjs',
  }),
  Object.freeze({
    source: '#!/usr/bin/env node\nexport const probe = true;\n',
    bootstrapSpecifier: '../__omnidraw_guest_bridge__.mjs',
  }),
]);

type TRunProcess = (
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    timeoutMs: number;
    maxOutputBytes: number;
    signal?: AbortSignal;
  }>,
) => Promise<string | void>;

type TConfig = Readonly<{
  scratchDirectory: string;
  runProcess?: TRunProcess;
  runnerIdentity?: string;
  installTimeoutMs?: number;
  buildTimeoutMs?: number;
  npmUserConfigPath: string;
  prepareNpmDependencies?: () => Promise<void>;
  mutableRegistryUrl?: string;
  maxWarmWorkspaces?: number;
}>;

type TDockerProcessConfig = Readonly<{
  image: string;
  npmUserConfigPath: string;
  cpus?: number;
  memoryMb?: number;
  pidsLimit?: number;
  runProcess?: TRunProcess;
  createId?: () => string;
  user?: string;
}>;

type TResolvedBuildRunner = Readonly<{
  kind: 'host' | 'docker';
  identity: string;
  runProcess: TRunProcess;
}>;

type TWidgetNpmBuildEnvironmentIdentityArgs = Readonly<{
  runnerIdentity: string;
  nodeVersion: string;
  npmVersion: string;
  platform: string;
  architecture: string;
  toolchainPinnedByRunner: boolean;
}>;

type TResolveBuildRunnerArgs = Readonly<{
  env: Readonly<Record<string, string | undefined>>;
  npmUserConfigPath: string;
  runProcess?: TRunProcess;
  createId?: () => string;
  user?: string;
}>;

type TWarmWorkspace = {
  root: string;
  dependencyIdentity: string | null;
  tail: Promise<void>;
  closed: boolean;
};

export type TWidgetNpmDistributionBuild = TOmnidrawDistributionBuild & Readonly<{
  closeWorkspace(workspaceKey: string): Promise<void>;
  close(): Promise<void>;
}>;

function hash(value: Uint8Array | string): CapsuleHash {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function boundedEnvironmentIdentityPart(value: string, label: string): string {
  if (
    value.length < 1
    || value.length > 160
    || value.trim() !== value
    || value.includes('\0')
  ) {
    throw new TypeError(`Widget build ${label} is invalid.`);
  }
  return value;
}

/**
 * Canonical pre-build identity for every runner/toolchain input that can affect
 * distribution output. Docker guest toolchains are pinned by the immutable
 * image-bearing runner identity rather than discovered by executing a build.
 */
export function fnWidgetNpmBuildEnvironmentIdentity(
  args: TWidgetNpmBuildEnvironmentIdentityArgs,
): string {
  assertRunnerIdentity(args.runnerIdentity);
  const transformOutputs = WIDGET_UI_ENTRY_TRANSFORM_PROBES.map((probe) => (
    fnBootstrapWidgetUiEntry(probe.source, probe.bootstrapSpecifier)
  ));
  return JSON.stringify({
    format: 'omnidraw.widget-npm-build-environment.v1',
    approvedTransformsDigest: hash(JSON.stringify({
      guestBridgeBootstrapSource: GUEST_BRIDGE_BOOTSTRAP_SOURCE,
      widgetUiEntryTransformOutputs: transformOutputs,
    })),
    buildConfigurationDigest: hash(JSON.stringify({
      producerName: PRODUCER_NAME,
      producerVersion: PRODUCER_VERSION,
      configuration: BUILD_CONFIGURATION,
    })),
    runnerIdentity: args.runnerIdentity,
    toolchain: {
      authority: args.toolchainPinnedByRunner ? 'runner' : 'explicit',
      nodeVersion: boundedEnvironmentIdentityPart(
        args.nodeVersion,
        'Node version identity',
      ),
      packageManager: 'npm',
      packageManagerVersion: boundedEnvironmentIdentityPart(
        args.npmVersion,
        'npm version identity',
      ),
      platform: boundedEnvironmentIdentityPart(
        args.platform,
        'platform identity',
      ),
      architecture: boundedEnvironmentIdentityPart(
        args.architecture,
        'architecture identity',
      ),
    },
  });
}

function commandError(
  code: string,
  command: string,
  args: readonly string[],
  message: string,
  reason?: string,
): Error {
  const construct = fnRedactBuildOutput(
    [command, ...args].join(' '),
    process.env,
  );
  return Object.assign(new Error(message), {
    diagnostic: Object.freeze({
      code,
      construct,
      ...(reason === undefined || reason === '' ? {} : { reason }),
    }),
  });
}

function abortError(): Error {
  return Object.assign(new Error('Widget build was superseded.'), {
    code: 'WIDGET_BUILD_SUPERSEDED',
  });
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortError();
}

function assertWorkspaceKey(workspaceKey: string): void {
  if (
    workspaceKey.length < 1
    || workspaceKey.length > 300
    || !/^[A-Za-z0-9._:-]+$/.test(workspaceKey)
  ) {
    throw new TypeError('Widget build workspace key is invalid.');
  }
}

function normalizeMutableRegistryUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const url = new URL(value);
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || url.username !== ''
    || url.password !== ''
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new TypeError('Widget mutable npm registry must be an unauthenticated loopback URL.');
  }
  if (url.port === '') url.port = '80';
  url.pathname = '/';
  return url.href;
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
    if (file.path === 'node_modules' || file.path.startsWith('node_modules/')) {
      throw new Error("Widget source cannot materialize the private 'node_modules' workspace.");
    }
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

async function materializePortableBuildManifest(
  root: string,
  manifest: TWidgetExecutableManifestProjection,
): Promise<void> {
  const portableManifest = Object.freeze({
    $schema: WIDGET_MANIFEST_V1_SCHEMA_URL,
    schemaVersion: 1 as const,
    name: 'Omnidraw isolated UI build',
    slug: 'omnidraw-isolated-ui-build',
    description: 'Generated manifest for the isolated UI distribution build.',
    tool: Object.freeze({
      label: 'Omnidraw isolated UI build',
      group: null,
      priority: 0,
    }),
    ui: manifest.ui,
    ...(manifest.resources.length === 0
      ? {}
      : { resources: manifest.resources }),
  });
  await writeFile(
    join(root, 'omnidraw.json'),
    `${JSON.stringify(portableManifest, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
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
    signal?: AbortSignal;
  }>,
): Promise<string> {
  if (options.signal?.aborted === true) return Promise.reject(abortError());
  return new Promise((resolvePromise, reject) => {
    const commandDisplay = fnRedactBuildOutput(
      [command, ...args].join(' '),
      process.env,
    );
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: fnWidgetBuildProcessEnvironment(
        process.env,
        options.cwd,
        process.platform,
      ),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputBytes = 0;
    let output = '';
    let settled = false;
    let terminalError: Error | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let termination: Promise<void> | undefined;
    const terminate = (): Promise<void> => {
      if (termination !== undefined) return termination;
      termination = txTerminateWidgetBuildProcessTree({
        platform: process.platform,
        killProcessGroup: (pid) => process.kill(-pid, 'SIGKILL'),
        taskkill: (pid) => new Promise((resolveTaskkill) => {
          let completed = false;
          const complete = (confirmed: boolean) => {
            if (completed) return;
            completed = true;
            resolveTaskkill(confirmed);
          };
          const treeKiller = spawn('taskkill', [
            '/PID',
            String(pid),
            '/T',
            '/F',
          ], {
            windowsHide: true,
            stdio: 'ignore',
          });
          treeKiller.once('error', () => complete(false));
          treeKiller.once('close', (code) => complete(code === 0));
        }),
      }, {
        pid: child.pid,
        killDirect: () => {
          child.kill('SIGKILL');
        },
      });
      return termination;
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
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
        void terminate();
        return;
      }
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.once('error', (error) => {
      terminalError ??= error;
    });
    child.once('close', async (code, signal) => {
      await termination;
      if (terminalError) {
        finish(terminalError);
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      const detail = fnBoundedBuildOutput(fnRedactBuildOutput(
        output.trim(),
        process.env,
        [
          options.cwd,
          ...(options.cwd.startsWith('/tmp/') ? [`/private${options.cwd}`] : []),
        ],
      ));
      const message = `Widget command '${commandDisplay}' failed`
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
    const onAbort = () => {
      if (terminalError) return;
      terminalError = abortError();
      void terminate();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted === true) onAbort();
    timeout = setTimeout(() => {
      if (terminalError) return;
      terminalError = commandError(
        'WIDGET_COMMAND_TIMEOUT',
        command,
        args,
        `Widget command '${commandDisplay}' timed out.`,
      );
      void terminate();
    }, options.timeoutMs);
  });
}

function assertDockerHostPath(path: string, label: string): void {
  if (
    !isAbsolute(path)
    || path.length > 1_024
    || /[\u0000\r\n,]/u.test(path)
  ) {
    throw new TypeError(`${label} must be an absolute host path without control characters or ','.`);
  }
}

function assertDockerImage(image: string): void {
  if (
    image.length > 300
    || !DOCKER_IMAGE_PATTERN.test(image)
  ) {
    throw new TypeError(
      `${WIDGET_BUILD_DOCKER_IMAGE_ENV} must be an immutable image reference pinned by sha256.`,
    );
  }
}

function assertDockerUser(user: string | undefined): void {
  if (user !== undefined && !/^[0-9]{1,10}:[0-9]{1,10}$/u.test(user)) {
    throw new TypeError('Widget Docker runner user must be a numeric uid:gid pair.');
  }
}

function assertRunnerIdentity(identity: string): void {
  if (
    identity.length < 1
    || identity.length > 160
    || !RUNNER_IDENTITY_PATTERN.test(identity)
  ) {
    throw new TypeError('Widget build runner identity is invalid.');
  }
}

function assertDockerResources(config: Readonly<{
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
}>): void {
  if (
    !Number.isFinite(config.cpus)
    || config.cpus < 0.25
    || config.cpus > 16
  ) {
    throw new TypeError('Widget Docker runner CPU limit must be between 0.25 and 16.');
  }
  if (
    !Number.isSafeInteger(config.memoryMb)
    || config.memoryMb < 256
    || config.memoryMb > 16_384
  ) {
    throw new TypeError('Widget Docker runner memory limit must be between 256 and 16384 MB.');
  }
  if (
    !Number.isSafeInteger(config.pidsLimit)
    || config.pidsLimit < 16
    || config.pidsLimit > 512
  ) {
    throw new TypeError('Widget Docker runner PID limit must be between 16 and 512.');
  }
}

function dockerRunnerIdentity(config: Readonly<{
  image: string;
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
}>): string {
  const digest = createHash('sha256').update(JSON.stringify({
    format: DOCKER_RUNNER_VERSION,
    image: config.image,
    resources: {
      cpus: config.cpus,
      memoryMb: config.memoryMb,
      pidsLimit: config.pidsLimit,
      tmpfsBytes: DOCKER_TMPFS_BYTES,
    },
    filesystem: {
      root: 'read-only',
      workspace: 'read-write-bind',
      npmUserConfig: 'read-only-bind-install-only',
    },
    network: 'bridge',
    capabilities: 'none',
    noNewPrivileges: true,
  })).digest('hex');
  return `${DOCKER_RUNNER_VERSION}.sha256.${digest}`;
}

function assertDockerInvocation(
  command: string,
  args: readonly string[],
  npmUserConfigPath: string,
): Readonly<{
  command: 'node' | 'npm';
  args: readonly string[];
  mountNpmUserConfig: boolean;
}> {
  if (
    command === 'npm'
    && args.length === 1
    && args[0] === '--version'
  ) {
    return Object.freeze({ command, args: Object.freeze([...args]), mountNpmUserConfig: false });
  }
  if (
    command === 'node'
    && args.length === 2
    && args[0] === '-p'
    && args[1] === NODE_ENVIRONMENT_EXPRESSION
  ) {
    return Object.freeze({ command, args: Object.freeze([...args]), mountNpmUserConfig: false });
  }
  if (
    command === 'npm'
    && args.length === 3
    && args[0] === 'ci'
    && args[1] === '--userconfig'
    && args[2] === npmUserConfigPath
  ) {
    return Object.freeze({
      command,
      args: Object.freeze(['ci', '--userconfig', DOCKER_NPM_USER_CONFIG_PATH]),
      mountNpmUserConfig: true,
    });
  }
  if (
    command === 'npm'
    && args.length === 2
    && args[0] === 'run'
    && args[1] === 'build'
  ) {
    return Object.freeze({ command, args: Object.freeze([...args]), mountNpmUserConfig: false });
  }
  throw new TypeError(`Widget Docker runner rejected command '${command} ${args.join(' ')}'.`);
}

function envNumber(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/u.test(value)) {
    throw new TypeError(`${name} must be a plain positive number.`);
  }
  return Number(value);
}

function envInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return Number(value);
}

/**
 * Converts the narrow widget process port into one fresh, bounded Docker
 * container per command. The adapter never forwards ambient host environment
 * variables and force-removes the named container after success, failure, or
 * cancellation.
 */
export function createWidgetDockerProcessAdapter(
  config: TDockerProcessConfig,
): TResolvedBuildRunner {
  const cpus = config.cpus ?? DOCKER_DEFAULT_CPUS;
  const memoryMb = config.memoryMb ?? DOCKER_DEFAULT_MEMORY_MB;
  const pidsLimit = config.pidsLimit ?? DOCKER_DEFAULT_PIDS_LIMIT;
  assertDockerImage(config.image);
  assertDockerHostPath(config.npmUserConfigPath, 'Widget Docker npm user config path');
  assertDockerUser(config.user);
  assertDockerResources({ cpus, memoryMb, pidsLimit });
  const execute = config.runProcess ?? runProcess;
  const createId = config.createId ?? randomUUID;
  const identity = dockerRunnerIdentity({
    image: config.image,
    cpus,
    memoryMb,
    pidsLimit,
  });
  assertRunnerIdentity(identity);

  const adapter: TRunProcess = async (command, args, options) => {
    assertActive(options.signal);
    assertDockerHostPath(options.cwd, 'Widget Docker workspace path');
    const invocation = assertDockerInvocation(
      command,
      args,
      config.npmUserConfigPath,
    );
    const id = createId();
    if (
      id.length < 1
      || id.length > 100
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(id)
    ) {
      throw new TypeError('Widget Docker runner container ID is invalid.');
    }
    const containerName = `omnidraw-widget-build-${id}`;
    const dockerArgs = [
      'run',
      '--init',
      '--pull',
      'never',
      '--name',
      containerName,
      '--workdir',
      DOCKER_WORKSPACE_PATH,
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges=true',
      '--network',
      'bridge',
      '--cpus',
      String(cpus),
      '--memory',
      `${memoryMb}m`,
      '--memory-swap',
      `${memoryMb}m`,
      '--pids-limit',
      String(pidsLimit),
      '--ulimit',
      'nofile=1024:1024',
      '--stop-timeout',
      '1',
      '--tmpfs',
      `/tmp:rw,nosuid,nodev,size=${DOCKER_TMPFS_BYTES},mode=1777`,
      '--mount',
      `type=bind,source=${options.cwd},target=${DOCKER_WORKSPACE_PATH}`,
      '--env',
      `HOME=${DOCKER_HOME_PATH}`,
      '--env',
      `npm_config_cache=${DOCKER_NPM_CACHE_PATH}`,
      ...(config.user === undefined ? [] : ['--user', config.user]),
      ...(invocation.mountNpmUserConfig
        ? [
            '--mount',
            `type=bind,source=${config.npmUserConfigPath},`
              + `target=${DOCKER_NPM_USER_CONFIG_PATH},readonly`,
          ]
        : []),
      config.image,
      invocation.command,
      ...invocation.args,
    ];
    try {
      return await execute('docker', dockerArgs, options);
    } finally {
      let cleanupError: unknown;
      for (let attempt = 0; attempt < DOCKER_CLEANUP_ATTEMPTS; attempt += 1) {
        try {
          await execute('docker', [
            'rm',
            '--force',
            '--volumes',
            containerName,
          ], {
            cwd: options.cwd,
            timeoutMs: DOCKER_CONTROL_TIMEOUT_MS,
            maxOutputBytes: DOCKER_CONTROL_OUTPUT_BYTES,
          });
          cleanupError = undefined;
          break;
        } catch (error) {
          cleanupError = error;
        }
      }
      if (cleanupError !== undefined) {
        throw Object.assign(new Error(
          `Docker did not confirm removal of widget build container '${containerName}'.`,
          { cause: cleanupError },
        ), {
          code: 'WIDGET_DOCKER_CLEANUP_FAILED',
        });
      }
    }
  };
  return Object.freeze({ kind: 'docker', identity, runProcess: adapter });
}

/**
 * Resolves the operator-selected runner. Host execution remains the default;
 * Docker requires an immutable image reference and only accepts bounded
 * resource overrides.
 */
export function resolveWidgetNpmBuildRunner(
  args: TResolveBuildRunnerArgs,
): TResolvedBuildRunner {
  const selected = (args.env[WIDGET_BUILD_RUNNER_ENV] ?? 'host').trim();
  if (selected === 'host') {
    return Object.freeze({
      kind: 'host',
      identity: HOST_RUNNER_IDENTITY,
      runProcess: args.runProcess ?? runProcess,
    });
  }
  if (selected !== 'docker') {
    throw new TypeError(`${WIDGET_BUILD_RUNNER_ENV} must be 'host' or 'docker'.`);
  }
  const image = args.env[WIDGET_BUILD_DOCKER_IMAGE_ENV]?.trim();
  if (image === undefined || image === '') {
    throw new TypeError(
      `${WIDGET_BUILD_DOCKER_IMAGE_ENV} is required when the widget build runner is Docker.`,
    );
  }
  return createWidgetDockerProcessAdapter({
    image,
    npmUserConfigPath: args.npmUserConfigPath,
    cpus: envNumber(
      args.env,
      WIDGET_BUILD_DOCKER_CPUS_ENV,
      DOCKER_DEFAULT_CPUS,
    ),
    memoryMb: envInteger(
      args.env,
      WIDGET_BUILD_DOCKER_MEMORY_MB_ENV,
      DOCKER_DEFAULT_MEMORY_MB,
    ),
    pidsLimit: envInteger(
      args.env,
      WIDGET_BUILD_DOCKER_PIDS_LIMIT_ENV,
      DOCKER_DEFAULT_PIDS_LIMIT,
    ),
    ...(args.runProcess === undefined ? {} : { runProcess: args.runProcess }),
    ...(args.createId === undefined ? {} : { createId: args.createId }),
    ...(args.user === undefined ? {} : { user: args.user }),
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
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    optionalDependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
  };
  const packageLock = JSON.parse(lockBytes.toString('utf8')) as {
    lockfileVersion?: unknown;
    packages?: Record<string, {
      link?: unknown;
      resolved?: unknown;
    }>;
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
  for (const sectionName of DEPENDENCY_SECTIONS) {
    for (const [name, specifier] of Object.entries(packageJson[sectionName] ?? {})) {
      if (
        typeof specifier !== 'string'
        || specifier.startsWith('file:')
        || specifier.startsWith('workspace:')
      ) {
        throw new Error(
          `Widget package.json dependency '${name}' must use a registry version.`,
        );
      }
    }
  }
  if (packageLock.packages === undefined || packageLock.packages[''] === undefined) {
    throw new Error('Widget package-lock.json must contain a packages map and root entry.');
  }
  for (const [path, entry] of Object.entries(packageLock.packages)) {
    if (
      entry.link === true
      || (
        typeof entry.resolved === 'string'
        && (
          entry.resolved.startsWith('file:')
          || entry.resolved.startsWith('/')
          || /^[A-Za-z]:[\\/]/u.test(entry.resolved)
          || entry.resolved.includes('.omnidraw-links')
        )
      )
    ) {
      throw new Error(
        `Widget package-lock.json entry '${path}' must resolve through a registry.`,
      );
    }
  }
  const lockSource = lockBytes.toString('utf8');
  if (
    lockSource.includes('"workspace:')
    || lockSource.includes('"file:')
    || lockSource.includes('.omnidraw-links')
  ) {
    throw new Error('Widget package-lock.json contains a local dependency.');
  }
  return Object.freeze({
    lockBytes: new Uint8Array(lockBytes),
    buildScript: packageJson.scripts.build,
  });
}

async function captureDistribution(root: string): Promise<Readonly<{
  files: readonly CapsuleSnapshotFile[];
  sourceMaps: readonly TOmnidrawDistributionSourceMap[];
}>> {
  const distributionRoot = join(root, DISTRIBUTION_DIRECTORY);
  const files: CapsuleSnapshotFile[] = [];
  const sourceMaps: TOmnidrawDistributionSourceMap[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (relativePath === WIDGET_BUILD_RECEIPT_PATH.slice('dist/'.length)) continue;
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
        files.length + sourceMaps.length + 1 > MAX_DISTRIBUTION_FILES
        || totalBytes > MAX_DISTRIBUTION_TOTAL_BYTES
      ) {
        throw new Error('Widget distribution exceeds its file or byte limit.');
      }
      const normalizedPath = posix.normalize(relativePath);
      if (normalizedPath.endsWith('.map')) {
        const module = normalizedPath.slice(0, -'.map'.length);
        if (!/\.(?:[cm]?js)$/u.test(module)) {
          throw new Error(`Widget distribution source map '${relativePath}' has no eligible module.`);
        }
        sourceMaps.push(Object.freeze({ module, bytes }));
      } else {
        files.push(Object.freeze({ path: normalizedPath, bytes }));
      }
    }
  }

  await visit(distributionRoot, '');
  if (!files.some((file) => file.path === DISTRIBUTION_ENTRY)) {
    throw new Error(`Widget distribution must contain '${DISTRIBUTION_ENTRY}'.`);
  }
  const generatedModules = new Set(files.map((file) => file.path));
  if (sourceMaps.some(({ module }) => !generatedModules.has(module))) {
    throw new Error('Widget distribution source map does not match an emitted module.');
  }
  return Object.freeze({
    files: Object.freeze(files),
    sourceMaps: Object.freeze(sourceMaps),
  });
}

function dependencyIdentity(files: readonly CapsuleSnapshotFile[]): string {
  const dependencyFiles = files
    .filter((file) => file.path === 'package.json' || file.path === 'package-lock.json')
    .sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash('sha256');
  for (const file of dependencyFiles) {
    digest.update(file.path);
    digest.update('\0');
    digest.update(file.bytes);
    digest.update('\0');
  }
  return digest.digest('hex');
}

async function clearWarmWorkspace(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (entry.name === 'node_modules' && entry.isDirectory()) return;
    await rm(join(root, entry.name), { recursive: true, force: true });
  }));
}

export function createWidgetNpmDistributionBuild(
  config: TConfig,
): TWidgetNpmDistributionBuild {
  const execute = config.runProcess ?? runProcess;
  const runnerIdentity = config.runnerIdentity ?? HOST_RUNNER_IDENTITY;
  const mutableRegistryUrl = normalizeMutableRegistryUrl(config.mutableRegistryUrl);
  assertRunnerIdentity(runnerIdentity);
  const maxWarmWorkspaces = config.maxWarmWorkspaces ?? 16;
  if (
    !Number.isSafeInteger(maxWarmWorkspaces)
    || maxWarmWorkspaces < 1
    || maxWarmWorkspaces > 128
  ) {
    throw new TypeError('Widget warm workspace limit is invalid.');
  }
  const workspaces = new Map<string, Promise<TWarmWorkspace>>();

  const closeEntry = async (entryPromise: Promise<TWarmWorkspace>): Promise<void> => {
    const entry = await entryPromise;
    entry.closed = true;
    await entry.tail;
    await rm(entry.root, { recursive: true, force: true });
  };

  const createWorkspace = (workspaceKey: string): Promise<TWarmWorkspace> => {
    const existing = workspaces.get(workspaceKey);
    if (existing !== undefined) {
      workspaces.delete(workspaceKey);
      workspaces.set(workspaceKey, existing);
      return existing;
    }
    const created = (async (): Promise<TWarmWorkspace> => {
      await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
      return {
        root: await mkdtemp(join(config.scratchDirectory, 'npm-workspace-')),
        dependencyIdentity: null,
        tail: Promise.resolve(),
        closed: false,
      };
    })();
    workspaces.set(workspaceKey, created);
    while (workspaces.size > maxWarmWorkspaces) {
      const oldestKey = workspaces.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = workspaces.get(oldestKey);
      workspaces.delete(oldestKey);
      if (oldest !== undefined) void closeEntry(oldest);
    }
    return created;
  };

  const performBuild = async (
    root: string,
    request: TOmnidrawDistributionBuildRequest,
    installRequired: boolean,
    onInstallComplete?: () => void,
  ): Promise<CapsuleBuildInput> => {
    assertActive(request.signal);
    await materialize(root, request.files);
    if (request.executableManifest !== undefined) {
      await materializePortableBuildManifest(root, request.executableManifest);
    }
    if (mutableRegistryUrl !== undefined) {
      await txRefreshMutableRegistryPackageLock({ join, readFile, writeFile }, {
        root,
        registryUrl: mutableRegistryUrl,
      });
    }
    const contract = await readPackageContract(root);
    if (contract.buildScript !== 'omnidraw-widget build .') {
      await bootstrapWidgetUiEntry(root, request.entry);
    }
    assertActive(request.signal);
    const npmVersionOutput = await execute('npm', ['--version'], {
      cwd: root,
      timeoutMs: 10_000,
      maxOutputBytes: 16 * 1024,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const npmVersionToken = typeof npmVersionOutput === 'string'
      ? npmVersionOutput.trim().split(/\s+/u)[0]?.slice(0, 64)
      : undefined;
    const npmVersion = npmVersionToken !== undefined
      && /^[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/u.test(npmVersionToken)
      ? npmVersionToken
      : 'injected';
    const nodeEnvironment = parseNodeEnvironment(await execute('node', [
      '-p',
      NODE_ENVIRONMENT_EXPRESSION,
    ], {
      cwd: root,
      timeoutMs: 10_000,
      maxOutputBytes: 16 * 1024,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    }));
    const buildEnvironment = Object.freeze({
      nodeVersion: nodeEnvironment.nodeVersion,
      npmVersion,
      platform: nodeEnvironment.platform,
      architecture: nodeEnvironment.architecture,
      runnerIdentity,
    });
    assertActive(request.signal);
    if (installRequired) {
      request.reportProgress?.('installing');
      await config.prepareNpmDependencies?.();
      assertActive(request.signal);
      await execute('npm', [
        'ci',
        '--userconfig',
        config.npmUserConfigPath,
      ], {
        cwd: root,
        timeoutMs: config.installTimeoutMs ?? 120_000,
        maxOutputBytes: MAX_BUILD_OUTPUT_BYTES,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
      onInstallComplete?.();
    }
    assertActive(request.signal);
    request.reportProgress?.('building');
    await execute('npm', ['run', 'build'], {
      cwd: root,
      timeoutMs: config.buildTimeoutMs ?? 120_000,
      maxOutputBytes: MAX_BUILD_OUTPUT_BYTES,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    assertActive(request.signal);
    const distribution = await captureDistribution(root);
    const files = distribution.files;
    const cssRoots = files
      .map((file) => file.path)
      .filter((path) => path.endsWith('.css'));
    return Object.freeze({
      kind: 'external-distribution',
      snapshot: Object.freeze({ files }),
      ...(distribution.sourceMaps.length === 0
        ? {}
        : { sourceMaps: distribution.sourceMaps }),
      entry: DISTRIBUTION_ENTRY,
      ...(cssRoots.length > 0 ? { cssRoots: Object.freeze(cssRoots) } : {}),
      producer: Object.freeze({
        name: PRODUCER_NAME,
        version: `${PRODUCER_VERSION}+runner.${runnerIdentity}.npm.${npmVersion}`,
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
  };

  const build = async (
    request: TOmnidrawDistributionBuildRequest,
  ): Promise<CapsuleBuildInput> => {
    if (request.workspaceKey !== undefined) {
      assertWorkspaceKey(request.workspaceKey);
      const workspace = await createWorkspace(request.workspaceKey);
      if (workspace.closed) throw new Error('Widget build workspace is closed.');
      const requestedDependencyIdentity = dependencyIdentity(request.files);
      const operation = workspace.tail.then(async () => {
        assertActive(request.signal);
        await clearWarmWorkspace(workspace.root);
        // Development packages can be republished to the loopback registry at
        // the same semantic version. Their authored lockfile identity therefore
        // cannot prove that a warm node_modules tree still has the current
        // bytes.
        const installRequired = mutableRegistryUrl !== undefined
          || workspace.dependencyIdentity !== requestedDependencyIdentity;
        let installCompleted = !installRequired;
        try {
          const result = await performBuild(
            workspace.root,
            request,
            installRequired,
            () => {
              installCompleted = true;
              workspace.dependencyIdentity = requestedDependencyIdentity;
            },
          );
          if (!installRequired) {
            workspace.dependencyIdentity = requestedDependencyIdentity;
          }
          return result;
        } catch (error) {
          if (installRequired && !installCompleted) workspace.dependencyIdentity = null;
          throw error;
        }
      });
      workspace.tail = operation.then(() => undefined, () => undefined);
      return operation;
    }

    await mkdir(config.scratchDirectory, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(join(config.scratchDirectory, 'npm-distribution-'));
    try {
      return await performBuild(root, request, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };

  return Object.assign(build, {
    async closeWorkspace(workspaceKey: string): Promise<void> {
      assertWorkspaceKey(workspaceKey);
      const entry = workspaces.get(workspaceKey);
      if (entry === undefined) return;
      workspaces.delete(workspaceKey);
      await closeEntry(entry);
    },
    async close(): Promise<void> {
      const entries = [...workspaces.values()];
      workspaces.clear();
      await Promise.all(entries.map(closeEntry));
    },
  });
}

export type {
  TConfig as TWidgetNpmDistributionBuildConfig,
  TDockerProcessConfig as TWidgetDockerProcessAdapterConfig,
  TResolvedBuildRunner as TWidgetNpmBuildRunner,
  TWidgetNpmBuildEnvironmentIdentityArgs,
  TRunProcess as TWidgetNpmDistributionBuildProcess,
};
