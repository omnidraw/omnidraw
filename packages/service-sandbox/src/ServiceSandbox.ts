import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { ISandboxDb } from '@vibecanvas/service-db/SandboxDb';
import type { TSandboxInstance, TSandboxInstanceStatus, TSandboxVolume, TSandboxVolumeStatus } from '@vibecanvas/service-db/model';
import { createHash } from 'crypto';

export const SERVICE_SANDBOX_NAME = 'sandbox' as const;
export const SERVICE_SANDBOX_BUN_VERSION = '1.3.14' as const;
export const SERVICE_SANDBOX_IMAGE = `oven/bun:${SERVICE_SANDBOX_BUN_VERSION}` as const;
export const SERVICE_SANDBOX_SETUP_GENERATION = 'base-os-v1' as const;
export const SERVICE_SANDBOX_VOLUME_MOUNT_PATH = '/home/vibecanvas' as const;
export const SERVICE_SANDBOX_WORKDIR = '/home/vibecanvas/worker' as const;

export type TServiceSandboxWorkerFile =
  | { readonly hostPath: string; readonly sandboxPath: string; readonly kind?: 'file' | 'dir' }
  | { readonly content: string | Uint8Array; readonly sandboxPath: string; readonly kind?: 'text' };

export type TServiceSandboxStartCommand = {
  readonly cmd: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
};

export type TServiceSandboxBindMount = {
  readonly hostPath: string;
  readonly guestPath: string;
  readonly readonly?: boolean;
};

export type TServiceSandboxDb = ISandboxDb;

export type TServiceSandboxConfig = {
  readonly db?: TServiceSandboxDb;
  readonly namespace?: string;
  readonly image?: string;
  readonly bunVersion?: string;
  readonly setupGeneration?: string;
  readonly volumeName?: string;
  readonly volumeTag?: string;
  readonly volumePrefix?: string;
  readonly volumeQuotaMib?: number;
  readonly sandboxName?: string;
  readonly setupPackages?: readonly string[];
  readonly runAptUpgrade?: boolean;
  readonly volumeMountPath?: string;
  readonly workdir?: string;
  readonly markerPath?: string;
  readonly workerFiles?: readonly TServiceSandboxWorkerFile[];
  readonly bindMounts?: readonly TServiceSandboxBindMount[];
  readonly startCommand?: TServiceSandboxStartCommand;
  readonly env?: Record<string, string | undefined>;
  readonly replaceSandbox?: boolean;
  readonly pullPolicy?: 'always' | 'if-missing' | 'never';
  readonly verifyHostVolume?: boolean;
  readonly forceSetup?: boolean;
  readonly loadMicrosandbox?: () => Promise<TMicrosandboxModule>;
};

export type TServiceSandboxRuntimeConfig = {
  readonly sandbox?: Partial<Pick<TServiceSandboxConfig, 'namespace' | 'volumeName' | 'volumeTag' | 'sandboxName' | 'forceSetup' | 'replaceSandbox' | 'workerFiles' | 'bindMounts' | 'startCommand' | 'env'>>;
};

export type TServiceSandboxStatus = {
  readonly sandboxName: string;
  readonly volumeName: string;
  readonly volumeTag: string;
  readonly image: string;
  readonly setupComplete: boolean;
  readonly sandboxStarted: boolean;
};

type TServiceContext<TConfig extends object> = { readonly config: TConfig };
type TSandboxInstanceRow = TSandboxInstance;
type TSandboxVolumeRow = TSandboxVolume;
export type TMicrosandboxOutput = { readonly success?: boolean; readonly code?: number; stdout?: () => string; stderr?: () => string };
export type TMicrosandboxFs = {
  write(path: string, content: Uint8Array): Promise<void>;
  copyFromHost(hostPath: string, sandboxPath: string): Promise<void>;
};
export type TMicrosandboxSandbox = {
  run?(name: string): Promise<TMicrosandboxOutput>;
  shell(command: string): Promise<TMicrosandboxOutput>;
  execStream(cmd: string, args?: readonly string[]): Promise<TMicrosandboxProcessHandle>;
  fs(): TMicrosandboxFs;
  stopAndWait?(): Promise<unknown>;
  stop?(): Promise<unknown>;
  kill?(): Promise<unknown>;
};
export type TMicrosandboxProcessHandle = { kill?(): Promise<unknown>; wait?(): Promise<unknown> };
export type TMicrosandboxModule = {
  Sandbox: {
    create?(config: Record<string, unknown>): Promise<TMicrosandboxSandbox>;
    builder?(name: string): TMicrosandboxSandboxBuilder;
    start(name: string): Promise<TMicrosandboxSandbox>;
    list(): Promise<readonly Record<string, unknown>[]>;
  };
  Volume: {
    create?(config: { name: string; quotaMib?: number }): Promise<unknown>;
    builder?(name: string): TMicrosandboxVolumeBuilder;
    list(): Promise<readonly Record<string, unknown>[]>;
  };
  Mount?: {
    named(name: string, options?: { readonly?: boolean }): unknown;
    bind?(hostPath: string, options?: { readonly?: boolean }): unknown;
  };
  NetworkPolicy?: { publicOnly(): unknown };
};

type TMicrosandboxSandboxBuilder = {
  image(value: string): TMicrosandboxSandboxBuilder;
  workdir(value: string): TMicrosandboxSandboxBuilder;
  shell(value: string): TMicrosandboxSandboxBuilder;
  envs(value: Record<string, string>): TMicrosandboxSandboxBuilder;
  volume(path: string, configure: (builder: TMicrosandboxMountBuilder) => TMicrosandboxMountBuilder): TMicrosandboxSandboxBuilder;
  scripts(value: Record<string, string>): TMicrosandboxSandboxBuilder;
  network(configure: (builder: TMicrosandboxNetworkPolicyBuilder) => TMicrosandboxNetworkPolicyBuilder): TMicrosandboxSandboxBuilder;
  replace(): TMicrosandboxSandboxBuilder;
  pullPolicy(value: string): TMicrosandboxSandboxBuilder;
  label?(key: string, value: string): TMicrosandboxSandboxBuilder;
  create(): Promise<TMicrosandboxSandbox>;
};

type TMicrosandboxVolumeBuilder = {
  quota(value: number): TMicrosandboxVolumeBuilder;
  create(): Promise<unknown>;
};

type TMicrosandboxMountBuilder = {
  named(name: string): TMicrosandboxMountBuilder;
  readonly(): TMicrosandboxMountBuilder;
  bind(hostPath: string): TMicrosandboxMountBuilder;
};

type TMicrosandboxNetworkPolicyBuilder = {
  defaultEgress(action: string): TMicrosandboxNetworkPolicyBuilder;
  defaultIngress(action: string): TMicrosandboxNetworkPolicyBuilder;
};

type TResolvedSandboxConfig = Required<Pick<TServiceSandboxConfig,
  'namespace' | 'image' | 'bunVersion' | 'setupGeneration' | 'volumeTag' | 'volumePrefix' | 'sandboxName' | 'setupPackages' | 'runAptUpgrade' | 'volumeMountPath' | 'workdir' | 'markerPath' | 'workerFiles' | 'bindMounts' | 'replaceSandbox' | 'verifyHostVolume' | 'forceSetup'
>> & Pick<TServiceSandboxConfig, 'db' | 'volumeName' | 'volumeQuotaMib' | 'startCommand' | 'pullPolicy' | 'loadMicrosandbox'> & { readonly env: Record<string, string> };

export class ServiceSandbox implements IService, IStartableService<object, TServiceSandboxRuntimeConfig>, IStoppableService {
  readonly name = SERVICE_SANDBOX_NAME;
  #baseConfig: TServiceSandboxConfig;
  #config: TResolvedSandboxConfig;
  #microsandbox?: TMicrosandboxModule;
  #sandbox?: TMicrosandboxSandbox;
  #process?: TMicrosandboxProcessHandle;
  #instance?: TSandboxInstanceRow | { readonly id: string; readonly sandbox_name: string; readonly sandbox_tag: string };
  #volume?: TSandboxVolumeRow | { readonly volume_name: string; readonly volume_tag: string };
  #setupComplete = false;

  constructor(config: TServiceSandboxConfig = {}) {
    this.#baseConfig = config;
    this.#config = resolveConfig(config, {});
  }

  async start(ctx?: TServiceContext<TServiceSandboxRuntimeConfig>): Promise<void> {
    this.#config = resolveConfig(this.#baseConfig, ctx?.config.sandbox ?? {});
    await this.#setup();
    await this.#startSandbox();
  }

  async stop(): Promise<void> {
    await this.#process?.kill?.().catch(() => undefined);
    this.#process = undefined;
    await this.#sandbox?.stopAndWait?.().catch(async () => {
      await this.#sandbox?.stop?.().catch(async () => {
        await this.#sandbox?.kill?.().catch(() => undefined);
      });
    });
    this.#sandbox = undefined;
  }

  getStatus(): TServiceSandboxStatus {
    const volumeName = this.#volume?.volume_name ?? resolveVolumeName(this.#config);
    return {
      sandboxName: this.#config.sandboxName,
      volumeName,
      volumeTag: this.#config.volumeTag,
      image: this.#config.image,
      setupComplete: this.#setupComplete,
      sandboxStarted: Boolean(this.#sandbox),
    };
  }

  async shell(command: string): Promise<TMicrosandboxOutput> {
    if (!this.#sandbox) throw new Error(`ServiceSandbox sandbox ${this.#config.sandboxName} is not started`);
    return await this.#sandbox.shell(command);
  }

  async #setup(): Promise<void> {
    this.#microsandbox = await (this.#config.loadMicrosandbox ?? loadMicrosandbox)();
    const instance = await this.#ensureInstance();
    this.#instance = instance;
    const volume = await this.#ensureVolume(instance.id);
    this.#volume = volume;

    const canReuseSandbox = !this.#config.forceSetup && !this.#config.replaceSandbox && isReadyVolume(volume);
    if (canReuseSandbox) {
      const started = await this.#tryStartExistingSandbox();
      if (started) {
        await this.#markInstanceRunning(instance.id);
        this.#setupComplete = true;
        return;
      }
      await this.#markInstanceMissing(instance.id, 'Sandbox row exists but host sandbox could not be started');
    }

    const setupScript = this.#setupScript(volume.volume_name);
    this.#sandbox = await createMicrosandbox(this.#microsandbox, {
      name: this.#config.sandboxName,
      image: this.#config.image,
      workdir: this.#config.volumeMountPath,
      shell: '/bin/bash',
      env: this.#config.env,
      volumeMountPath: this.#config.volumeMountPath,
      volumeName: volume.volume_name,
      bindMounts: this.#config.bindMounts,
      scripts: { setup: setupScript },
      replace: true,
      pullPolicy: this.#config.pullPolicy ?? 'if-missing',
      labels: {
        app: 'vibecanvas',
        service: 'service-sandbox',
        sandboxTag: this.#config.volumeTag,
      },
    });

    const output = await runMicrosandboxSetup(this.#sandbox, setupScript);
    if (output.success === false || (typeof output.code === 'number' && output.code !== 0)) {
      const stderr = output.stderr?.() ?? '';
      await this.#markInstanceFailed(instance.id, stderr || `setup exited with code ${output.code}`);
      await this.#markVolumeFailed(volume.volume_name, stderr || `setup exited with code ${output.code}`);
      throw new Error(`ServiceSandbox setup failed for ${volume.volume_name}: ${stderr || output.code}`);
    }

    await this.#markInstanceRunning(instance.id);
    await this.#markVolumeReady(volume.volume_name);
    this.#setupComplete = true;
  }

  async #startSandbox(): Promise<void> {
    if (!this.#sandbox) {
      const started = await this.#tryStartExistingSandbox();
      if (!started) throw new Error(`ServiceSandbox sandbox ${this.#config.sandboxName} was not created during setup`);
    }

    await this.#sandbox!.shell(`mkdir -p ${shellQuote(this.#config.workdir)}`);
    await this.#copyWorkerFiles();

    if (!this.#config.startCommand) return;
    const command = this.#config.startCommand;
    if (command.cwd && command.cwd !== this.#config.workdir) await this.#sandbox!.shell(`mkdir -p ${shellQuote(command.cwd)}`);
    const streamCommand = toStreamCommand(command, this.#config.workdir);
    this.#process = await this.#sandbox!.execStream(streamCommand.cmd, streamCommand.args);
  }

  async #ensureInstance(): Promise<TSandboxInstanceRow | { readonly id: string; readonly sandbox_name: string; readonly sandbox_tag: string }> {
    if (!this.#config.db) return { id: this.#config.sandboxName, sandbox_name: this.#config.sandboxName, sandbox_tag: this.#config.volumeTag };
    const existing = this.#config.db.findInstance({
      namespace: this.#config.namespace,
      sandboxName: this.#config.sandboxName,
      sandboxTag: this.#config.volumeTag,
      image: this.#config.image,
      setupHash: setupHash(this.#config),
    });
    if (existing) return existing;
    return await this.#upsertInstance(this.#config.sandboxName, 'creating', null);
  }

  async #ensureVolume(instanceId: string): Promise<TSandboxVolumeRow | { readonly volume_name: string; readonly volume_tag: string }> {
    const existing = await this.#findReusableVolume(instanceId);
    if (existing) return existing;

    const volumeName = resolveVolumeName(this.#config);
    if (this.#config.db) await this.#upsertVolume(instanceId, volumeName, 'creating', false, null);
    await this.#createHostVolumeIfNeeded(volumeName);
    return this.#config.db ? await this.#upsertVolume(instanceId, volumeName, 'creating', false, null) : { volume_name: volumeName, volume_tag: this.#config.volumeTag };
  }

  async #findReusableVolume(instanceId: string): Promise<TSandboxVolumeRow | null> {
    if (!this.#config.db) return null;
    const rows = this.#config.db.findReusableVolumes({
      instanceId,
      namespace: this.#config.namespace,
      volumeTag: this.#config.volumeTag,
      setupHash: setupHash(this.#config),
    });

    for (const row of rows) {
      if (await this.#hostVolumeExists(row.volume_name)) {
        await this.#upsertVolume(instanceId, row.volume_name, 'ready', true, null);
        return row;
      }
      await this.#upsertVolume(instanceId, row.volume_name, 'missing', false, 'Volume row exists but host volume is missing');
    }
    return null;
  }

  async #createHostVolumeIfNeeded(volumeName: string): Promise<void> {
    if (await this.#hostVolumeExists(volumeName)) return;
    await createMicrosandboxVolume(this.#microsandbox!, volumeName, this.#config.volumeQuotaMib);
  }

  async #hostVolumeExists(volumeName: string): Promise<boolean> {
    if (!this.#config.verifyHostVolume) return true;
    const volumes = await this.#microsandbox!.Volume.list();
    return volumes.some((volume) => volume.name === volumeName || volume.volumeName === volumeName || volume.volume_name === volumeName);
  }

  async #tryStartExistingSandbox(): Promise<boolean> {
    try {
      this.#sandbox = await this.#microsandbox!.Sandbox.start(this.#config.sandboxName);
      return true;
    } catch {
      return false;
    }
  }

  async #upsertInstance(sandboxName: string, status: TSandboxInstanceRow['status'], lastError: string | null): Promise<TSandboxInstanceRow> {
    const now = new Date();
    void now;
    return this.#config.db!.upsertInstance({
      namespace: this.#config.namespace,
      sandboxName,
      sandboxTag: this.#config.volumeTag,
      image: this.#config.image,
      setupHash: setupHash(this.#config),
      status,
      metadata: instanceMetadata(this.#config),
      lastError,
    });
  }

  async #upsertVolume(instanceId: string, volumeName: string, status: TSandboxVolumeRow['status'], reusable: boolean, lastError: string | null): Promise<TSandboxVolumeRow> {
    const now = new Date();
    void now;
    return this.#config.db!.upsertVolume({
      instanceId,
      namespace: this.#config.namespace,
      volumeName,
      volumeTag: this.#config.volumeTag,
      setupHash: setupHash(this.#config),
      status,
      reusable,
      metadata: volumeMetadata(this.#config),
      lastError,
    });
  }

  async #markInstanceRunning(instanceId: string): Promise<void> {
    if (this.#config.db) await this.#upsertInstanceById(instanceId, 'running', null);
  }

  async #markInstanceMissing(instanceId: string, error: string): Promise<void> {
    if (this.#config.db) await this.#upsertInstanceById(instanceId, 'missing', error.slice(0, 2000));
  }

  async #markInstanceFailed(instanceId: string, error: string): Promise<void> {
    if (this.#config.db) await this.#upsertInstanceById(instanceId, 'failed', error.slice(0, 2000));
  }

  async #upsertInstanceById(instanceId: string, status: TSandboxInstanceRow['status'], lastError: string | null): Promise<void> {
    const now = new Date();
    void now;
    this.#config.db!.updateInstanceStatus({ id: instanceId, status, lastError });
  }

  async #markVolumeReady(volumeName: string): Promise<void> {
    if (this.#config.db && this.#instance) await this.#upsertVolume(this.#instance.id, volumeName, 'ready', true, null);
  }

  async #markVolumeFailed(volumeName: string, error: string): Promise<void> {
    if (this.#config.db && this.#instance) await this.#upsertVolume(this.#instance.id, volumeName, 'failed', false, error.slice(0, 2000));
  }

  async #copyWorkerFiles(): Promise<void> {
    const fs = this.#sandbox!.fs();
    for (const file of this.#config.workerFiles) {
      await this.#sandbox!.shell(`mkdir -p ${shellQuote(dirname(file.sandboxPath))}`);
      if ('content' in file) {
        const content = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content;
        await fs.write(file.sandboxPath, content);
      } else {
        await fs.copyFromHost(file.hostPath, file.sandboxPath);
      }
    }
  }

  #setupScript(volumeName: string): string {
    const marker = JSON.stringify({
      app: 'vibecanvas',
      service: 'service-sandbox',
      volumeName,
      volumeTag: this.#config.volumeTag,
      image: this.#config.image,
      setupHash: setupHash(this.#config),
      generatedAt: new Date().toISOString(),
    }, null, 2);
    const packages = this.#config.setupPackages.map(shellQuote).join(' ');
    const upgrade = this.#config.runAptUpgrade ? 'apt-get upgrade -y\n' : '';
    return `#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  ${upgrade}apt-get install -y --no-install-recommends ${packages}
  rm -rf /var/lib/apt/lists/*
fi
mkdir -p ${shellQuote(this.#config.volumeMountPath)} ${shellQuote(this.#config.workdir)} ${shellQuote(dirname(this.#config.markerPath))}
cat > ${shellQuote(this.#config.markerPath)} <<'VIBECANVAS_SANDBOX_MARKER'
${marker}
VIBECANVAS_SANDBOX_MARKER
`;
  }
}

async function loadMicrosandbox(): Promise<TMicrosandboxModule> {
  return await import('microsandbox') as unknown as TMicrosandboxModule;
}

type TCreateMicrosandboxArgs = {
  readonly name: string;
  readonly image: string;
  readonly workdir: string;
  readonly shell: string;
  readonly env: Record<string, string>;
  readonly volumeMountPath: string;
  readonly volumeName: string;
  readonly bindMounts: readonly TServiceSandboxBindMount[];
  readonly scripts: Record<string, string>;
  readonly replace: boolean;
  readonly pullPolicy: string;
  readonly labels: Record<string, string>;
};

async function runMicrosandboxSetup(sandbox: TMicrosandboxSandbox, setupScript: string): Promise<TMicrosandboxOutput> {
  if (sandbox.run) return await sandbox.run('setup');
  return await sandbox.shell(setupScript);
}

function createLegacyMicrosandboxVolumes(module: TMicrosandboxModule, args: TCreateMicrosandboxArgs): Record<string, unknown> {
  const volumes: Record<string, unknown> = { [args.volumeMountPath]: module.Mount?.named(args.volumeName) };
  for (const mount of args.bindMounts) {
    if (!module.Mount?.bind) throw new Error('Unsupported microsandbox module: missing Mount.bind');
    volumes[mount.guestPath] = module.Mount.bind(mount.hostPath, { readonly: mount.readonly });
  }
  return volumes;
}

async function createMicrosandbox(module: TMicrosandboxModule, args: TCreateMicrosandboxArgs): Promise<TMicrosandboxSandbox> {
  if (module.Sandbox.create) {
    return await module.Sandbox.create({
      name: args.name,
      image: args.image,
      workdir: args.workdir,
      shell: args.shell,
      env: args.env,
      volumes: createLegacyMicrosandboxVolumes(module, args),
      scripts: args.scripts,
      network: module.NetworkPolicy?.publicOnly(),
      replace: args.replace,
      pullPolicy: args.pullPolicy,
      labels: args.labels,
    });
  }

  if (!module.Sandbox.builder) throw new Error('Unsupported microsandbox module: missing Sandbox.builder');
  let builder = module.Sandbox.builder(args.name)
    .image(args.image)
    .workdir(args.workdir)
    .shell(args.shell)
    .envs(args.env)
    .volume(args.volumeMountPath, (mount) => mount.named(args.volumeName))
    .scripts(args.scripts)
    .pullPolicy(args.pullPolicy);
  for (const mount of args.bindMounts) {
    builder = builder.volume(mount.guestPath, (mountBuilder) => {
      const bound = mountBuilder.bind(mount.hostPath);
      return mount.readonly ? bound.readonly() : bound;
    });
  }
  if (args.replace) builder = builder.replace();
  for (const [key, value] of Object.entries(args.labels)) builder = builder.label?.(key, value) ?? builder;
  return await builder.create();
}

async function createMicrosandboxVolume(module: TMicrosandboxModule, volumeName: string, quotaMib: number | undefined): Promise<void> {
  if (module.Volume.create) {
    await module.Volume.create({ name: volumeName, quotaMib });
    return;
  }
  if (!module.Volume.builder) throw new Error('Unsupported microsandbox module: missing Volume.builder');
  let builder = module.Volume.builder(volumeName);
  if (typeof quotaMib === 'number') builder = builder.quota(quotaMib);
  await builder.create();
}

function resolveConfig(base: TServiceSandboxConfig, override: NonNullable<TServiceSandboxRuntimeConfig['sandbox']>): TResolvedSandboxConfig {
  const bunVersion = overrideValue(base.bunVersion, undefined, SERVICE_SANDBOX_BUN_VERSION);
  const image = overrideValue(base.image, undefined, `oven/bun:${bunVersion}`);
  const namespace = overrideValue(base.namespace, override.namespace, 'default');
  const setupGeneration = overrideValue(base.setupGeneration, undefined, SERVICE_SANDBOX_SETUP_GENERATION);
  const volumeTag = overrideValue(base.volumeTag, override.volumeTag, `bun-${bunVersion}-${setupGeneration}`);
  const volumePrefix = overrideValue(base.volumePrefix, undefined, 'vibecanvas-sandbox');
  const sandboxName = overrideValue(base.sandboxName, override.sandboxName, `${volumePrefix}-${namespace}-${sanitizeName(volumeTag)}`);
  const volumeMountPath = overrideValue(base.volumeMountPath, undefined, SERVICE_SANDBOX_VOLUME_MOUNT_PATH);
  const workdir = overrideValue(base.workdir, undefined, SERVICE_SANDBOX_WORKDIR);
  const env = Object.fromEntries(Object.entries({ ...base.env, ...override.env }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return {
    db: base.db,
    namespace,
    image,
    bunVersion,
    setupGeneration,
    volumeName: overrideValue(base.volumeName, override.volumeName, undefined),
    volumeTag,
    volumePrefix,
    volumeQuotaMib: base.volumeQuotaMib,
    sandboxName,
    setupPackages: base.setupPackages ?? ['vim-tiny', 'curl', 'ca-certificates'],
    runAptUpgrade: base.runAptUpgrade ?? true,
    volumeMountPath,
    workdir,
    markerPath: base.markerPath ?? `${volumeMountPath}/.vibecanvas/sandbox-volume.json`,
    workerFiles: override.workerFiles ?? base.workerFiles ?? [],
    bindMounts: override.bindMounts ?? base.bindMounts ?? [],
    startCommand: override.startCommand ?? base.startCommand,
    env,
    replaceSandbox: override.replaceSandbox ?? base.replaceSandbox ?? false,
    pullPolicy: base.pullPolicy,
    verifyHostVolume: base.verifyHostVolume ?? true,
    forceSetup: override.forceSetup ?? base.forceSetup ?? false,
    loadMicrosandbox: base.loadMicrosandbox,
  };
}

function resolveVolumeName(config: TResolvedSandboxConfig): string {
  return config.volumeName ?? `${config.volumePrefix}-${config.namespace}-${sanitizeName(config.volumeTag)}-${setupHash(config).slice(0, 10)}`;
}

function setupHash(config: TResolvedSandboxConfig): string {
  return createHash('sha256').update(JSON.stringify({
    image: config.image,
    setupGeneration: config.setupGeneration,
    setupPackages: config.setupPackages,
    runAptUpgrade: config.runAptUpgrade,
    volumeMountPath: config.volumeMountPath,
    workdir: config.workdir,
  })).digest('hex');
}

function instanceMetadata(config: TResolvedSandboxConfig): Record<string, unknown> {
  return {
    bunVersion: config.bunVersion,
    setupGeneration: config.setupGeneration,
    setupPackages: [...config.setupPackages],
    runAptUpgrade: config.runAptUpgrade,
    volumeMountPath: config.volumeMountPath,
    workdir: config.workdir,
    markerPath: config.markerPath,
    bindMounts: config.bindMounts.map((mount) => ({ guestPath: mount.guestPath, readonly: mount.readonly ?? false })),
  };
}

function volumeMetadata(config: TResolvedSandboxConfig): Record<string, unknown> {
  return {
    sandboxName: config.sandboxName,
    sandboxTag: config.volumeTag,
    setupGeneration: config.setupGeneration,
    volumeMountPath: config.volumeMountPath,
    markerPath: config.markerPath,
  };
}

function isReadyVolume(volume: TSandboxVolumeRow | { readonly volume_name: string; readonly volume_tag: string }): volume is TSandboxVolumeRow {
  return 'status' in volume && volume.status === 'ready' && volume.reusable === true;
}

function toStreamCommand(command: TServiceSandboxStartCommand, fallbackCwd: string): { readonly cmd: string; readonly args: readonly string[] } {
  if (!command.cwd && !command.env) return { cmd: command.cmd, args: command.args ?? [] };
  const cwd = command.cwd ?? fallbackCwd;
  const env = Object.entries(command.env ?? {}).map(([key, value]) => `${key}=${shellQuote(value)}`).join(' ');
  const execCommand = [env, 'exec', shellQuote(command.cmd), ...(command.args ?? []).map(shellQuote)].filter(Boolean).join(' ');
  return { cmd: 'bash', args: ['-lc', `cd ${shellQuote(cwd)} && ${execCommand}`] };
}

function sanitizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  if (index <= 0) return '/';
  return path.slice(0, index);
}

function overrideValue<T>(base: T | undefined, override: T | undefined, fallback: T): T;
function overrideValue<T>(base: T | undefined, override: T | undefined, fallback: T | undefined): T | undefined;
function overrideValue<T>(base: T | undefined, override: T | undefined, fallback: T | undefined): T | undefined {
  return override ?? base ?? fallback;
}
