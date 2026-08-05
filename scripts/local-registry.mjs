#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  openSync,
  rmSync,
} from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const RUNTIME_MANIFEST_PATH = join(
  REPOSITORY_ROOT,
  'scripts',
  'local-registry',
  'package.json',
);
const RUNTIME_LOCK_PATH = join(
  REPOSITORY_ROOT,
  'scripts',
  'local-registry',
  'package-lock.json',
);
const OWNED_SCOPES = Object.freeze(['@omnidraw/']);
const WIDGET_PACKAGE_ROOT = '@omnidraw/sdk';
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 8_000;

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function settings() {
  const homeDirectory = homedir();
  const stateDirectory = resolve(
    process.env.LOCAL_NPM_REGISTRY_STATE_DIR
      ?? join(homeDirectory, '.local', 'share', 'verdaccio'),
  );
  if (dirname(stateDirectory) === stateDirectory || stateDirectory === resolve(homeDirectory)) {
    throw new Error('LOCAL_NPM_REGISTRY_STATE_DIR must not be a filesystem or home root.');
  }
  const registryUrl = new URL(
    process.env.LOCAL_NPM_REGISTRY_URL ?? 'http://127.0.0.1:4873/',
  );
  if (
    registryUrl.protocol !== 'http:'
    || registryUrl.hostname !== '127.0.0.1'
    || registryUrl.username !== ''
    || registryUrl.password !== ''
    || (registryUrl.pathname !== '/' && registryUrl.pathname !== '')
  ) {
    throw new Error(
      'LOCAL_NPM_REGISTRY_URL must be an unauthenticated loopback URL such as '
      + 'http://127.0.0.1:4873/.',
    );
  }
  if (registryUrl.port === '') registryUrl.port = '80';
  registryUrl.pathname = '/';
  const toolDirectory = join(stateDirectory, 'tool');
  return Object.freeze({
    stateDirectory,
    registryUrl: registryUrl.href,
    hostname: registryUrl.hostname,
    port: Number(registryUrl.port),
    configPath: join(stateDirectory, 'config.json'),
    storageDirectory: join(stateDirectory, 'storage'),
    authPath: join(stateDirectory, 'htpasswd'),
    pidPath: join(stateDirectory, 'owner.json'),
    logPath: join(stateDirectory, 'logs', 'verdaccio.log'),
    npmUserConfigPath: join(stateDirectory, 'npmrc'),
    widgetNpmUserConfigPath: join(stateDirectory, 'npmjs.npmrc'),
    startLockPath: join(stateDirectory, 'start.lock'),
    publishLockPath: join(stateDirectory, 'publish.lock'),
    toolDirectory,
    toolManifestPath: join(toolDirectory, 'package.json'),
    verdaccioBin: join(toolDirectory, 'node_modules', 'verdaccio', 'bin', 'verdaccio'),
    verdaccioManifestPath: join(
      toolDirectory,
      'node_modules',
      'verdaccio',
      'package.json',
    ),
  });
}

async function atomicWrite(path, value, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, value, { mode });
  await rename(temporaryPath, path);
}

async function runtimeManifest() {
  const manifest = JSON.parse(await readFile(RUNTIME_MANIFEST_PATH, 'utf8'));
  const version = manifest.dependencies?.verdaccio;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('The isolated registry runtime must pin one exact Verdaccio version.');
  }
  return Object.freeze({ manifest, version });
}

async function writeHostConfiguration(config) {
  const { manifest } = await runtimeManifest();
  const runtimeLock = await readFile(RUNTIME_LOCK_PATH, 'utf8');
  const registry = new URL(config.registryUrl);
  const registryAuthKey = `//${registry.host}${registry.pathname}`;
  await Promise.all([
    mkdir(config.storageDirectory, { recursive: true, mode: 0o700 }),
    mkdir(dirname(config.logPath), { recursive: true, mode: 0o700 }),
    atomicWrite(config.toolManifestPath, `${JSON.stringify(manifest, null, 2)}\n`),
    atomicWrite(join(config.toolDirectory, 'package-lock.json'), runtimeLock),
    atomicWrite(config.npmUserConfigPath, [
      'registry=https://registry.npmjs.org/',
      `@omnidraw:registry=${config.registryUrl}`,
      `${registryAuthKey}:_authToken=omnidraw-local-development`,
      '',
    ].join('\n')),
    atomicWrite(config.widgetNpmUserConfigPath, [
      'registry=https://registry.npmjs.org/',
      '@omnidraw:registry=https://registry.npmjs.org/',
      '',
    ].join('\n')),
    atomicWrite(config.configPath, `${JSON.stringify({
      storage: config.storageDirectory,
      listen: config.registryUrl,
      auth: {
        htpasswd: {
          file: config.authPath,
          max_users: -1,
        },
      },
      uplinks: {
        npmjs: {
          url: 'https://registry.npmjs.org/',
        },
      },
      packages: {
        '@omnidraw/*': {
          access: '$all',
          publish: '$all',
          unpublish: '$authenticated',
          proxy: 'npmjs',
        },
        '**': {
          access: '$all',
          publish: '$authenticated',
          unpublish: '$authenticated',
          proxy: 'npmjs',
        },
      },
      web: {
        enable: false,
      },
      log: {
        type: 'stdout',
        format: 'pretty',
        level: 'http',
      },
    }, null, 2)}\n`),
  ]);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise(Object.freeze({ stdout, stderr }));
        return;
      }
      reject(new Error([
        `Command failed (${signal ?? code}): ${command} ${args.join(' ')}`,
        stdout.trim(),
        stderr.trim(),
      ].filter(Boolean).join('\n')));
    });
  });
}

async function installRuntime(config) {
  const { version } = await runtimeManifest();
  const installedVersion = await readFile(config.verdaccioManifestPath, 'utf8')
    .then((source) => JSON.parse(source).version)
    .catch(() => null);
  if (installedVersion === version) return version;
  await run('npm', [
    'ci',
    '--prefix',
    config.toolDirectory,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry',
    'https://registry.npmjs.org/',
  ]);
  const actualVersion = JSON.parse(
    await readFile(config.verdaccioManifestPath, 'utf8'),
  ).version;
  if (actualVersion !== version) {
    throw new Error(`Expected Verdaccio ${version}, installed ${String(actualVersion)}.`);
  }
  return version;
}

async function readOwner(config) {
  try {
    const value = JSON.parse(await readFile(config.pidPath, 'utf8'));
    if (
      !Number.isSafeInteger(value.pid)
      || value.pid <= 1
      || value.registryUrl !== config.registryUrl
      || value.configPath !== config.configPath
      || value.verdaccioBin !== config.verdaccioBin
      || !Number.isFinite(value.processStartedAtMs)
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function processCommand(pid) {
  if (process.platform === 'linux') {
    const source = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
    if (source !== '') return source.split('\0').join(' ');
  }
  return run('ps', ['-p', String(pid), '-o', 'command='])
    .then(({ stdout }) => stdout.trim())
    .catch(() => '');
}

async function processStartedAtMs(pid) {
  const { stdout } = await run('ps', ['-p', String(pid), '-o', 'lstart='])
    .catch(() => ({ stdout: '' }));
  const timestamp = Date.parse(stdout.trim());
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function isOwnedProcess(config, owner) {
  if (!owner || !processExists(owner.pid)) return false;
  const [command, startedAtMs] = await Promise.all([
    processCommand(owner.pid),
    processStartedAtMs(owner.pid),
  ]);
  return (
    startedAtMs === owner.processStartedAtMs
    && (
      command.trim() === 'verdaccio'
      || (
        command.includes(config.verdaccioBin)
        && command.includes(config.configPath)
      )
    )
  );
}

async function registryHealth(config) {
  try {
    const response = await fetch(new URL('-/ping', config.registryUrl), {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function portIsOpen(config) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: config.hostname, port: config.port });
    const done = (value) => {
      socket.destroy();
      resolvePromise(value);
    };
    socket.setTimeout(800);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function registryStatus(config) {
  const owner = await readOwner(config);
  const [healthy, occupied, owned] = await Promise.all([
    registryHealth(config),
    portIsOpen(config),
    isOwnedProcess(config, owner),
  ]);
  const state = healthy
    ? (owned ? 'running' : 'unmanaged')
    : (occupied ? 'port-conflict' : (owned ? 'unhealthy' : 'stopped'));
  return Object.freeze({
    state,
    registryUrl: config.registryUrl,
    stateDirectory: config.stateDirectory,
    npmUserConfigPath: config.npmUserConfigPath,
    widgetNpmUserConfigPath: config.widgetNpmUserConfigPath,
    pid: owned ? owner.pid : null,
    healthy,
  });
}

async function acquireStartLock(config) {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      await mkdir(config.startLockPath, { mode: 0o700 });
      await writeFile(join(config.startLockPath, 'owner'), `${process.pid}\n`);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const age = Date.now() - await stat(config.startLockPath)
        .then((value) => value.mtimeMs)
        .catch(() => Date.now());
      if (age > 30_000) {
        await rm(config.startLockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for registry start lock ${config.startLockPath}.`);
      }
      await sleep(100);
    }
  }
}

async function acquirePublishLock(config) {
  const deadline = Date.now() + 5 * 60_000;
  while (true) {
    try {
      await mkdir(config.publishLockPath, { mode: 0o700 });
      await writeFile(join(config.publishLockPath, 'owner'), `${process.pid}\n`);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const age = Date.now() - await stat(config.publishLockPath)
        .then((value) => value.mtimeMs)
        .catch(() => Date.now());
      if (age > 10 * 60_000) {
        await rm(config.publishLockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for registry publication lock ${config.publishLockPath}.`);
      }
      await sleep(100);
    }
  }
}

async function waitFor(config, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(100);
  }
  return predicate();
}

async function startRegistry(config) {
  await writeHostConfiguration(config);
  await acquireStartLock(config);
  try {
    const current = await registryStatus(config);
    if (current.state === 'running') return current;
    if (current.state !== 'stopped') {
      throw new Error(
        `Cannot start the local registry: ${config.registryUrl} is ${current.state}. `
        + `Inspect the process using port ${config.port}; this tool will not replace it.`,
      );
    }
    const verdaccioVersion = await installRuntime(config);
    const logDescriptor = openSync(config.logPath, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY, 0o600);
    const child = spawn(process.execPath, [
      config.verdaccioBin,
      '--config',
      config.configPath,
      '--listen',
      config.registryUrl,
    ], {
      cwd: config.stateDirectory,
      env: {
        ...process.env,
        VERDACCIO_HANDLE_KILL_SIGNALS: 'true',
      },
      detached: true,
      stdio: ['ignore', logDescriptor, logDescriptor],
    });
    child.unref();
    closeSync(logDescriptor);
    const processStartedAtMsValue = await waitFor(
      config,
      async () => (await processStartedAtMs(child.pid)) !== null,
      2_000,
    )
      ? await processStartedAtMs(child.pid)
      : null;
    if (processStartedAtMsValue === null) {
      throw new Error('Could not record the Verdaccio process start identity.');
    }
    await atomicWrite(config.pidPath, `${JSON.stringify({
      pid: child.pid,
      processStartedAtMs: processStartedAtMsValue,
      registryUrl: config.registryUrl,
      configPath: config.configPath,
      verdaccioBin: config.verdaccioBin,
      verdaccioVersion,
      startedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    const started = await waitFor(
      config,
      () => registryHealth(config),
      START_TIMEOUT_MS,
    );
    if (!started) {
      const owner = await readOwner(config);
      if (await isOwnedProcess(config, owner)) process.kill(owner.pid, 'SIGTERM');
      throw new Error(
        `Verdaccio did not become healthy. Inspect ${config.logPath}.`,
      );
    }
    return registryStatus(config);
  } finally {
    await rm(config.startLockPath, { recursive: true, force: true });
  }
}

async function startRegistryForeground(config) {
  await writeHostConfiguration(config);
  await acquireStartLock(config);
  let child;
  let childExit;
  try {
    const current = await registryStatus(config);
    if (current.state !== 'stopped') {
      throw new Error(
        `Cannot start the local registry in the foreground: ${config.registryUrl} is ${current.state}. `
        + `Stop the existing registry or inspect the process using port ${config.port}.`,
      );
    }
    const verdaccioVersion = await installRuntime(config);
    child = spawn(process.execPath, [
      config.verdaccioBin,
      '--config',
      config.configPath,
      '--listen',
      config.registryUrl,
    ], {
      cwd: config.stateDirectory,
      env: {
        ...process.env,
        VERDACCIO_HANDLE_KILL_SIGNALS: 'true',
      },
      stdio: 'inherit',
    });
    childExit = new Promise((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        resolvePromise(Object.freeze({ code, signal }));
      });
    });
    const processStartedAtMsValue = await waitFor(
      config,
      async () => (await processStartedAtMs(child.pid)) !== null,
      2_000,
    )
      ? await processStartedAtMs(child.pid)
      : null;
    if (processStartedAtMsValue === null) {
      throw new Error('Could not record the foreground Verdaccio process start identity.');
    }
    await atomicWrite(config.pidPath, `${JSON.stringify({
      pid: child.pid,
      processStartedAtMs: processStartedAtMsValue,
      registryUrl: config.registryUrl,
      configPath: config.configPath,
      verdaccioBin: config.verdaccioBin,
      verdaccioVersion,
      startedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    const started = await waitFor(
      config,
      () => registryHealth(config),
      START_TIMEOUT_MS,
    );
    if (!started) {
      if (child.exitCode === null) child.kill('SIGTERM');
      throw new Error(
        `Foreground Verdaccio did not become healthy. Inspect its terminal output.`,
      );
    }
  } finally {
    await rm(config.startLockPath, { recursive: true, force: true });
  }

  const forwardSignal = (signal) => {
    rmSync(config.pidPath, { force: true });
    if (child.exitCode === null) child.kill(signal);
  };
  const onSigint = () => forwardSignal('SIGINT');
  const onSigterm = () => forwardSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    const result = await childExit;
    const owner = await readOwner(config);
    if (owner?.pid === child.pid && await isOwnedProcess(config, owner) === false) {
      await rm(config.pidPath, { force: true });
    }
    return result;
  } finally {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
  }
}

async function stopRegistry(config) {
  const owner = await readOwner(config);
  if (!await isOwnedProcess(config, owner)) {
    const current = await registryStatus(config);
    if (current.state === 'stopped') return current;
    throw new Error(
      `Refusing to stop ${config.registryUrl}: its process is not proven to be `
      + `the registry recorded in ${config.pidPath}.`,
    );
  }
  process.kill(owner.pid, 'SIGTERM');
  const stopped = await waitFor(
    config,
    () => Promise.resolve(!processExists(owner.pid)),
    STOP_TIMEOUT_MS,
  );
  if (!stopped && await isOwnedProcess(config, owner)) {
    process.kill(owner.pid, 'SIGKILL');
    await waitFor(config, () => Promise.resolve(!processExists(owner.pid)), 2_000);
  }
  await rm(config.pidPath, { force: true });
  return registryStatus(config);
}

async function tarballManifest(tarball) {
  const { stdout } = await run('tar', ['-xOf', tarball, 'package/package.json']);
  const manifest = JSON.parse(stdout);
  if (
    typeof manifest.name !== 'string'
    || typeof manifest.version !== 'string'
    || !OWNED_SCOPES.some((scope) => manifest.name.startsWith(scope))
  ) {
    throw new Error(`${tarball} is not a versioned package in an owned scope.`);
  }
  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
  });
}

async function tarballIntegrity(tarball) {
  const bytes = await readFile(tarball);
  return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

async function publishedIntegrity(config, name, version) {
  const packageUrl = new URL(encodeURIComponent(name), config.registryUrl);
  const response = await fetch(packageUrl);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Registry metadata request failed (${response.status}) for ${name}.`);
  }
  const metadata = await response.json();
  return metadata.versions?.[version]?.dist?.integrity ?? null;
}

async function publicIntegrity(name, version) {
  const packageUrl = new URL(
    `${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    'https://registry.npmjs.org/',
  );
  try {
    const response = await fetch(packageUrl);
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    const metadata = await response.json();
    return metadata.dist?.integrity ?? null;
  } catch {
    return undefined;
  }
}

/**
 * Decides what a publish attempt must do given what's already on the
 * registry at the exact same `name@version`.
 *
 * - `publish`: nothing occupies that version yet.
 * - `unchanged`: the exact bytes are already there; this is a no-op.
 * - `overwrite`: different bytes occupy that version and the caller opted in
 *   (`allowOverwrite`) to replacing them — the automated form of the "use a
 *   development prerelease" escape hatch this tool has always documented.
 * - `reject`: different bytes occupy that version and the caller did not opt
 *   in; real-npm-style immutability applies and the caller must bump the
 *   version or use a prerelease.
 */
export function publishDecision(existingIntegrity, integrity, allowOverwrite) {
  if (existingIntegrity === null) return 'publish';
  if (existingIntegrity === integrity) return 'unchanged';
  return allowOverwrite ? 'overwrite' : 'reject';
}

/**
 * Publishes one tarball to the local registry.
 *
 * By default this enforces real-npm-style immutability: publishing different
 * bytes under an already-occupied `name@version` is a hard failure, and the
 * caller must bump the version or use a prerelease (this is the contract
 * `publish`/`bootstrap` rely on for externally-produced tarballs, e.g. the
 * cangine/capsule artifacts seeded by `bootstrap` — those really are "install
 * this known-good external artifact" operations, and must stay strict).
 *
 * `options.allowOverwrite` relaxes that for the internal workspace-sync path
 * only (`publishWidgetPackages` → `syncWorkspacePackage` → `packWorkspacePackage`):
 * the local registry there is an ephemeral, dev-only scratch store rebuilt
 * from this checkout's own source on every use, so nothing durable depends on
 * a given local `name@version`'s bytes staying frozen. When bytes differ, the
 * conflicting version is unpublished and replaced instead of throwing, so an
 * edit to a workspace package's source never requires a manual `package.json`
 * version bump just to keep local dev working (D9). See `publishDecision`.
 */
async function publishTarball(config, requestedTarball, options = {}) {
  const allowOverwrite = options.allowOverwrite === true;
  const tarball = resolve(requestedTarball);
  await access(tarball);
  const [{ name, version }, integrity] = await Promise.all([
    tarballManifest(tarball),
    tarballIntegrity(tarball),
  ]);
  const existingIntegrity = await publishedIntegrity(config, name, version);
  const decision = publishDecision(existingIntegrity, integrity, allowOverwrite);
  if (decision === 'unchanged') {
    return Object.freeze({
      name,
      version,
      integrity,
      registryUrl: config.registryUrl,
      status: 'unchanged',
    });
  }
  if (decision === 'reject') {
    throw new Error(
      `${name}@${version} already exists with different bytes `
      + `(${existingIntegrity} != ${integrity}). Bump the version or use a prerelease.`,
    );
  }
  if (decision === 'overwrite') {
    await run('npm', [
      'unpublish',
      `${name}@${version}`,
      '--registry',
      config.registryUrl,
      '--userconfig',
      config.npmUserConfigPath,
      '--force',
    ], {
      cwd: config.stateDirectory,
    });
  }
  await run('npm', [
    'publish',
    tarball,
    '--registry',
    config.registryUrl,
    '--userconfig',
    config.npmUserConfigPath,
    '--ignore-scripts',
    '--provenance=false',
    '--json',
  ], {
    cwd: config.stateDirectory,
  });
  const storedIntegrity = await publishedIntegrity(config, name, version);
  if (storedIntegrity !== integrity) {
    throw new Error(
      `${name}@${version} published with unexpected integrity ${String(storedIntegrity)}.`,
    );
  }
  return Object.freeze({
    name,
    version,
    integrity,
    registryUrl: config.registryUrl,
    status: decision === 'publish' ? 'published' : 'overwritten',
  });
}

function workspaceDependencyNames(entry, byName) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap((field) => Object.keys(entry.manifest[field] ?? {}))
    .filter((name) => byName.has(name));
}

async function versionedWorkspacePackages() {
  const packagesDirectory = join(REPOSITORY_ROOT, 'packages');
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const packages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesDirectory, entry.name);
    const manifest = await readFile(join(directory, 'package.json'), 'utf8')
      .then((source) => JSON.parse(source))
      .catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
    if (manifest === null || manifest.version === undefined) continue;
    if (
      typeof manifest.name !== 'string'
      || typeof manifest.version !== 'string'
      || manifest.private === true
    ) {
      throw new Error(`${directory}/package.json has an invalid public package identity.`);
    }
    packages.push(Object.freeze({
      name: manifest.name,
      version: manifest.version,
      directory,
      manifest,
    }));
  }
  return packages;
}

export function widgetPackagePublishOrder(packages, rootName = WIDGET_PACKAGE_ROOT) {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  if (!byName.has(rootName)) {
    throw new Error(`Widget package root ${rootName} is not a versioned workspace package.`);
  }
  const closure = new Map();
  const visit = (name) => {
    if (closure.has(name)) return;
    const entry = byName.get(name);
    if (entry === undefined) return;
    closure.set(name, entry);
    for (const dependency of workspaceDependencyNames(entry, byName)) visit(dependency);
  };
  visit(rootName);

  const remaining = new Map(closure);
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((entry) =>
      workspaceDependencyNames(entry, byName).every((dependency) => !remaining.has(dependency)));
    if (ready.length === 0) {
      throw new Error(`Versioned widget package dependency cycle: ${[...remaining.keys()].join(', ')}.`);
    }
    ready.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of ready) {
      remaining.delete(entry.name);
      ordered.push(entry);
    }
  }
  return Object.freeze(ordered);
}

async function packWorkspacePackage(config, entry) {
  await run('bun', ['run', '--filter', entry.name, 'build']);
  const packDirectory = await mkdtemp(join(config.stateDirectory, 'widget-package-pack-'));
  try {
    await run('npm', [
      'pack',
      join(entry.directory, 'dist'),
      '--pack-destination',
      packDirectory,
      '--ignore-scripts',
      '--json',
    ]);
    const tarballs = (await readdir(packDirectory))
      .filter((entry) => entry.endsWith('.tgz'));
    if (tarballs.length !== 1) {
      throw new Error(`Packing staged ${entry.name} produced no unique tarball.`);
    }
    // Workspace-local packages are always safe to overwrite in place: see the
    // `publishTarball` doc comment for why this differs from `publish`/`bootstrap`.
    return await publishTarball(config, join(packDirectory, tarballs[0]), { allowOverwrite: true });
  } finally {
    await rm(packDirectory, { recursive: true, force: true });
  }
}

export function widgetPackageSyncSource(registryIntegrity, npmIntegrity) {
  if (registryIntegrity === null) return 'workspace';
  if (npmIntegrity === registryIntegrity) return 'upstream';
  if (npmIntegrity === undefined) return 'available';
  return 'workspace';
}

async function syncWorkspacePackage(config, entry) {
  const [registryIntegrity, npmIntegrity] = await Promise.all([
    publishedIntegrity(config, entry.name, entry.version),
    publicIntegrity(entry.name, entry.version),
  ]);
  const source = widgetPackageSyncSource(registryIntegrity, npmIntegrity);
  if (source !== 'workspace') {
    return Object.freeze({
      name: entry.name,
      version: entry.version,
      integrity: registryIntegrity,
      registryUrl: config.registryUrl,
      status: source,
    });
  }
  return packWorkspacePackage(config, entry);
}

async function publishWidgetPackages(config) {
  await acquirePublishLock(config);
  try {
    const packages = await versionedWorkspacePackages();
    const ordered = widgetPackagePublishOrder(packages);
    const results = [];
    for (const entry of ordered) results.push(await syncWorkspacePackage(config, entry));
    return Object.freeze(results);
  } finally {
    await rm(config.publishLockPath, { recursive: true, force: true });
  }
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a path.`);
  return value;
}

async function main() {
  const config = settings();
  const [command = 'status', ...args] = process.argv.slice(2);
  if (command === 'status') {
    console.log(JSON.stringify(await registryStatus(config), null, 2));
    return;
  }
  if (command === 'start' || command === 'ensure') {
    console.log(JSON.stringify(await startRegistry(config), null, 2));
    return;
  }
  if (command === 'start-foreground') {
    const result = await startRegistryForeground(config);
    if (result.code !== 0 && result.code !== null) process.exitCode = result.code;
    return;
  }
  if (command === 'stop') {
    console.log(JSON.stringify(await stopRegistry(config), null, 2));
    return;
  }
  if (command === 'publish') {
    if (args.length === 0) throw new Error('publish requires one or more package tarballs.');
    await startRegistry(config);
    const results = [];
    for (const tarball of args) results.push(await publishTarball(config, tarball));
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (command === 'publish-widget-packages' || command === 'publish-sdk') {
    await startRegistry(config);
    console.log(JSON.stringify(await publishWidgetPackages(config), null, 2));
    return;
  }
  if (command === 'bootstrap') {
    const cangine = flagValue(args, '--cangine');
    const capsule = flagValue(args, '--capsule');
    if (!cangine || !capsule) {
      throw new Error('bootstrap requires --cangine <tarball> and --capsule <tarball>.');
    }
    await startRegistry(config);
    const results = [
      await publishTarball(config, cangine),
      await publishTarball(config, capsule),
    ];
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  throw new Error(
    `Unknown command '${command}'. Use start, start-foreground, ensure, status, stop, publish, `
    + 'publish-widget-packages, publish-sdk, or bootstrap.',
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
