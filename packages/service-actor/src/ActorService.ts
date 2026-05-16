import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import { SqliteWorkflowDb, type TWorkflowDb } from '@vibecanvas/service-workflow';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ActorSupervisor } from './ActorSupervisor';
import { ACTOR_SERVICE_NAME, DEFAULT_ACTOR_CONTROL_PORT, DEFAULT_ACTOR_LEASE_MS, DEFAULT_ACTOR_POLL_INTERVAL_MS, DEFAULT_ACTOR_SANDBOX_NAME, DEFAULT_ACTOR_WORKER_ID } from './core/CONSTANTS';

export type TActorServiceWorkerEnv = Record<string, string | undefined>;

export type TActorSandboxStartArgs = {
  readonly sandboxName: string;
  readonly workerDistPath: string;
  readonly workerEnv: Record<string, string>;
  readonly controlPort: number;
};

export type TActorSandboxHandle = {
  readonly stop: () => Promise<void>;
  readonly isHealthy?: () => Promise<boolean>;
};

export type TActorSandboxRunner = {
  readonly start: (args: TActorSandboxStartArgs) => Promise<TActorSandboxHandle>;
};

export type TActorServiceConfig = {
  readonly db: TDrizzleDb;
  readonly workflowDb?: TWorkflowDb;
  readonly workerEnv?: TActorServiceWorkerEnv;
  readonly sandboxName?: string;
  readonly workerId?: string;
  readonly workerDistPath?: string;
  readonly controlPort?: number;
  readonly pollIntervalMs?: number;
  readonly leaseMs?: number;
  readonly autoStart?: boolean;
  readonly startSandbox?: boolean;
  readonly sandboxRunner?: TActorSandboxRunner;
};

export type TActorServiceRuntimeConfig = {
  readonly actorService?: {
    readonly autoStart?: boolean;
    readonly startSandbox?: boolean;
  };
};

export type TActorServiceStatus = {
  readonly sandboxStarted: boolean;
  readonly workerStarted: boolean;
  readonly supervisor: ReturnType<ActorSupervisor['getStatus']>;
};

type TServiceContext<TConfig extends object> = {
  readonly config: TConfig;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

export class ActorService implements IService, IStartableService<object, TActorServiceRuntimeConfig>, IStoppableService {
  readonly name = ACTOR_SERVICE_NAME;
  readonly db: TDrizzleDb;
  readonly workflowDb: TWorkflowDb;
  readonly supervisor: ActorSupervisor;
  readonly sandboxName: string;
  readonly workerId: string;
  readonly workerDistPath: string;
  readonly controlPort: number;
  readonly leaseMs: number;
  readonly pollIntervalMs: number;
  readonly workerEnv: TActorServiceWorkerEnv;
  readonly autoStart: boolean;
  readonly startSandboxByDefault: boolean;
  readonly sandboxRunner: TActorSandboxRunner;
  #handle?: TActorSandboxHandle;
  #stopPromise?: Promise<void>;

  constructor(config: TActorServiceConfig) {
    this.db = config.db;
    this.workflowDb = config.workflowDb ?? new SqliteWorkflowDb({ db: config.db });
    this.sandboxName = config.sandboxName ?? DEFAULT_ACTOR_SANDBOX_NAME;
    this.workerId = config.workerId ?? DEFAULT_ACTOR_WORKER_ID;
    this.workerDistPath = config.workerDistPath ?? resolve(process.cwd(), 'apps/worker/dist/worker.mjs');
    this.controlPort = config.controlPort ?? DEFAULT_ACTOR_CONTROL_PORT;
    this.leaseMs = config.leaseMs ?? DEFAULT_ACTOR_LEASE_MS;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_ACTOR_POLL_INTERVAL_MS;
    this.workerEnv = config.workerEnv ?? {};
    this.autoStart = config.autoStart ?? true;
    this.startSandboxByDefault = config.startSandbox ?? true;
    this.sandboxRunner = config.sandboxRunner ?? createMissingSandboxRunner();
    this.supervisor = new ActorSupervisor({ db: this.db, workflowDb: this.workflowDb, workerId: this.workerId, pollIntervalMs: this.pollIntervalMs });
  }

  async start(ctx?: TServiceContext<TActorServiceRuntimeConfig>): Promise<void> {
    const shouldStartSandbox = ctx?.config.actorService?.startSandbox ?? this.startSandboxByDefault;
    const shouldAutoStart = ctx?.config.actorService?.autoStart ?? this.autoStart;

    try {
      if (shouldStartSandbox) await this.startSandboxWorker();
      if (shouldAutoStart) await this.supervisor.start();
      else await this.supervisor.loadActors();
    } catch (error) {
      await this.stop().catch(() => undefined);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.#stopPromise) this.#stopPromise = this.stopNow();
    await this.#stopPromise;
  }

  getStatus(): TActorServiceStatus {
    return { sandboxStarted: Boolean(this.#handle), workerStarted: Boolean(this.#handle), supervisor: this.supervisor.getStatus() };
  }

  private async startSandboxWorker(): Promise<void> {
    if (!existsSync(this.workerDistPath)) {
      throw new Error(`ActorService worker bundle not found at ${this.workerDistPath}. Run "bun --filter @vibecanvas/worker build" first.`);
    }
    this.#handle = await this.sandboxRunner.start({
      sandboxName: this.sandboxName,
      workerDistPath: this.workerDistPath,
      controlPort: this.controlPort,
      workerEnv: this.workerEnvForSandbox(),
    });
    await this.waitForWorkerHealth();
  }

  private async waitForWorkerHealth(): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (!this.#handle?.isHealthy) return;
      if (await this.#handle.isHealthy()) return;
      await wait(250);
    }
    throw new Error('Timed out waiting for ActorService sandbox worker health');
  }

  private workerEnvForSandbox(): Record<string, string> {
    const entries = Object.entries({
      ...this.workerEnv,
      VIBECANVAS_WORKER_ID: this.workerId,
      VIBECANVAS_WORKER_SANDBOX_NAME: this.sandboxName,
      VIBECANVAS_WORKER_CONTROL_HOST: '127.0.0.1',
      VIBECANVAS_WORKER_CONTROL_PORT: String(this.controlPort),
      VIBECANVAS_WORKER_LEASE_MS: String(this.leaseMs),
      VIBECANVAS_WORKER_POLL_INTERVAL_MS: String(this.pollIntervalMs),
    });
    return Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  }

  private async stopNow(): Promise<void> {
    this.supervisor.stop();
    await this.#handle?.stop().catch(() => undefined);
    this.#handle = undefined;
  }
}

function createMissingSandboxRunner(): TActorSandboxRunner {
  return {
    start: async () => {
      throw new Error('ActorService requires an injected sandboxRunner when startSandbox is enabled');
    },
  };
}
