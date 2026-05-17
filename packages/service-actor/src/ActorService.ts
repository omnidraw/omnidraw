import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { SqliteWorkflowDb, type TWorkflowDb } from '@vibecanvas/service-workflow';
import { eq } from 'drizzle-orm';
import { existsSync } from 'fs';
import { resolve } from 'path';
import * as schema from '@vibecanvas/service-db/schema';
import { ActorSupervisor } from './ActorSupervisor';
import { ACTOR_BOOT_MESSAGE_NAME, ACTOR_SERVICE_NAME, DEFAULT_ACTOR_CONTROL_PORT, DEFAULT_ACTOR_LEASE_MS, DEFAULT_ACTOR_POLL_INTERVAL_MS, DEFAULT_ACTOR_SANDBOX_NAME, DEFAULT_ACTOR_WORKER_ID } from './core/CONSTANTS';
import { fnCreateBootMessage } from './core/fn.machine';
import { fxGetActorRows, fxNextActorInboxSeq } from './core/fx.actor-db';
import { txInsertInbox, txPatchActorInstance } from './core/tx.actor-db';

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
  readonly eventPublisher?: IEventPublisherService;
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

export type TActorServiceSendMessageArgs = {
  readonly actorInstanceId: string;
  readonly eventName: string;
  readonly params?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly sourceActorInstanceId?: string;
  readonly sourceOutputId?: string;
  readonly connectionId?: string;
};

export type TActorServiceSendMessageResult = {
  readonly accepted: true;
  readonly inboxId: string;
  readonly messageId: string;
  readonly correlationId: string;
  readonly actorInstanceId: string;
  readonly canvasId: string;
};

export type TActorServiceWidgetSource = {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly widgetDir: string;
  readonly vibecanvasJsonPath: string;
  readonly vibecanvasJson: unknown;
  readonly actor: {
    readonly functionsPath: string;
    readonly functionsGuestPath: string;
    readonly functionsSource: string;
  };
  readonly widget: {
    readonly sourceDir: string;
    readonly files: Readonly<Record<string, string>>;
  };
  readonly loadedAt: string;
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
  readonly eventPublisher?: IEventPublisherService;
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
  readonly #widgetSourcesBySlug = new Map<string, TActorServiceWidgetSource>();
  readonly #widgetSourcesById = new Map<string, TActorServiceWidgetSource>();
  #handle?: TActorSandboxHandle;
  #stopPromise?: Promise<void>;

  constructor(config: TActorServiceConfig) {
    this.db = config.db;
    this.workflowDb = config.workflowDb ?? new SqliteWorkflowDb({ db: config.db });
    this.eventPublisher = config.eventPublisher;
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
    this.supervisor = new ActorSupervisor({ db: this.db, workflowDb: this.workflowDb, eventPublisher: this.eventPublisher, workerId: this.workerId, pollIntervalMs: this.pollIntervalMs });
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

  upsertWidgetSource(source: TActorServiceWidgetSource): void {
    this.#widgetSourcesBySlug.set(source.slug, source);
    this.#widgetSourcesById.set(source.id, source);
  }

  getWidgetSource(idOrSlug: string): TActorServiceWidgetSource | null {
    return this.#widgetSourcesBySlug.get(idOrSlug) ?? this.#widgetSourcesById.get(idOrSlug) ?? null;
  }

  listWidgetSources(): TActorServiceWidgetSource[] {
    return [...this.#widgetSourcesBySlug.values()].sort((left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug));
  }

  clearWidgetSources(): void {
    this.#widgetSourcesBySlug.clear();
    this.#widgetSourcesById.clear();
  }

  async sendMessage(args: TActorServiceSendMessageArgs): Promise<TActorServiceSendMessageResult> {
    const portal = this.portal();
    const rows = fxGetActorRows(portal, { actorInstanceId: args.actorInstanceId });
    const messageId = args.correlationId ? `${args.correlationId}:message:${this.supervisor.idFactory()}` : this.supervisor.idFactory();
    const correlationId = args.correlationId ?? messageId;
    const inbox = txInsertInbox(portal, {
      workspaceId: rows.instance.workspace_id,
      canvasId: rows.instance.canvas_id,
      actorInstanceId: rows.instance.id,
      seq: fxNextActorInboxSeq(portal, { actorInstanceId: rows.instance.id }),
      messageId,
      correlationId,
      causationId: args.causationId,
      idempotencyKey: `api:${rows.instance.id}:message:${messageId}`,
      sourceActorInstanceId: args.sourceActorInstanceId,
      sourceOutputId: args.sourceOutputId,
      connectionId: args.connectionId,
      message: { name: args.eventName, payload: (args.params ?? {}) as never },
      createdAt: new Date(),
    });

    await this.nudgeSupervisor();

    return {
      accepted: true,
      inboxId: inbox.id,
      messageId,
      correlationId,
      actorInstanceId: rows.instance.id,
      canvasId: rows.instance.canvas_id,
    };
  }

  async bootInstance(args: { readonly actorInstanceId: string }): Promise<void> {
    const portal = this.portal();
    const rows = fxGetActorRows(portal, { actorInstanceId: args.actorInstanceId });
    if (rows.instance.status !== 'created') return;

    const bootExists = this.db.select().from(schema.actor_inbox).all()
      .some((row) => row.actor_instance_id === rows.instance.id && row.event_name === ACTOR_BOOT_MESSAGE_NAME);
    if (bootExists) return;

    const correlationId = `boot:${rows.instance.id}`;
    txInsertInbox(portal, {
      workspaceId: rows.instance.workspace_id,
      canvasId: rows.instance.canvas_id,
      actorInstanceId: rows.instance.id,
      seq: fxNextActorInboxSeq(portal, { actorInstanceId: rows.instance.id }),
      messageId: correlationId,
      correlationId,
      idempotencyKey: correlationId,
      message: fnCreateBootMessage({ correlationId }),
      createdAt: new Date(),
    });
    txPatchActorInstance(portal, { actorInstanceId: rows.instance.id, patch: { status: 'starting' } });
    this.publishActorInstanceUpdated(rows.instance.canvas_id, args.actorInstanceId);
    await this.nudgeSupervisor();
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

  private portal() {
    return { db: this.db, tables: schema, idFactory: this.supervisor.idFactory, eq };
  }

  private async nudgeSupervisor(): Promise<void> {
    await this.supervisor.runOnce().catch(() => undefined);
  }

  private publishActorInstanceUpdated(canvasId: string, actorInstanceId: string): void {
    const instance = this.db.select().from(schema.actor_instances).all().find((actor) => actor.id === actorInstanceId);
    if (!instance) return;
    this.eventPublisher?.publishActorEvent(canvasId, { type: 'actor.instance.updated', canvasId, instance });
  }
}

function createMissingSandboxRunner(): TActorSandboxRunner {
  return {
    start: async () => {
      throw new Error('ActorService requires an injected sandboxRunner when startSandbox is enabled');
    },
  };
}
