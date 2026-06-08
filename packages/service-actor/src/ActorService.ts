import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ActorSupervisor } from './ActorSupervisor';
import { ACTOR_BOOT_MESSAGE_NAME, ACTOR_SERVICE_NAME, DEFAULT_ACTOR_CONTROL_PORT, DEFAULT_ACTOR_LEASE_MS, DEFAULT_ACTOR_POLL_INTERVAL_MS, DEFAULT_ACTOR_SANDBOX_NAME, DEFAULT_ACTOR_WORKER_ID } from './core/CONSTANTS';
import { fnCreateBootMessage } from './core/fn.machine';
import { fxGetActorRows, fxNextActorInboxSeq } from './core/fx.actor-db';
import { txInsertInbox, txPatchActorInstance } from './core/tx.actor-db';
import type { TActorConnectionRow, TActorInstanceRow } from './core/types';

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
  readonly db: ActorDb;
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
  readonly startSandboxInBackground?: boolean;
  readonly sandboxRunner?: TActorSandboxRunner;
};

export type TActorServiceRuntimeConfig = {
  readonly actorService?: {
    readonly autoStart?: boolean;
    readonly startSandbox?: boolean;
    readonly startSandboxInBackground?: boolean;
  };
};

export type TActorServiceStatus = {
  readonly sandboxStarted: boolean;
  readonly workerStarted: boolean;
  readonly backgroundSandboxError: string | null;
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

export type TActorServiceRemoveInstanceArgs = {
  readonly actorInstanceId: string;
  readonly reason?: string;
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
  readonly db: ActorDb;
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
  readonly startSandboxInBackgroundByDefault: boolean;
  readonly sandboxRunner: TActorSandboxRunner;
  readonly #widgetSourcesBySlug = new Map<string, TActorServiceWidgetSource>();
  readonly #widgetSourcesById = new Map<string, TActorServiceWidgetSource>();
  #handle?: TActorSandboxHandle;
  #stopPromise?: Promise<void>;

  constructor(config: TActorServiceConfig) {
    this.db = config.db;
    if (!config.workflowDb) throw new Error('ActorService requires workflowDb when Drizzle is hidden behind service-db');
    this.workflowDb = config.workflowDb;
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
    this.startSandboxInBackgroundByDefault = config.startSandboxInBackground ?? false;
    this.sandboxRunner = config.sandboxRunner ?? createMissingSandboxRunner();
    this.supervisor = new ActorSupervisor({ db: this.db, workflowDb: this.workflowDb, eventPublisher: this.eventPublisher, workerId: this.workerId, pollIntervalMs: this.pollIntervalMs });
  }

  async start(ctx?: TServiceContext<TActorServiceRuntimeConfig>): Promise<void> {
    const shouldStartSandbox = ctx?.config.actorService?.startSandbox ?? this.startSandboxByDefault;
    const shouldStartSandboxInBackground = ctx?.config.actorService?.startSandboxInBackground ?? this.startSandboxInBackgroundByDefault;
    const shouldAutoStart = ctx?.config.actorService?.autoStart ?? this.autoStart;

    try {
      if (shouldStartSandbox && shouldStartSandboxInBackground) this.startSandboxWorkerInBackground();
      else if (shouldStartSandbox) await this.startSandboxWorker();
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
    return { sandboxStarted: Boolean(this.#handle), workerStarted: Boolean(this.#handle), backgroundSandboxError: this.#lastBackgroundSandboxError, supervisor: this.supervisor.getStatus() };
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

    const bootExists = this.db.hasBootInbox(rows.instance.id, ACTOR_BOOT_MESSAGE_NAME);
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

  async removeInstance(args: TActorServiceRemoveInstanceArgs): Promise<TActorInstanceRow | null> {
    const existing = this.db.getActorInstance(args.actorInstanceId);
    if (!existing) return null;

    const stopping = txPatchActorInstance(this.portal(), {
      actorInstanceId: existing.id,
      patch: { status: 'stopping' },
    });
    this.publishActorInstanceUpdated(stopping.canvas_id, stopping.id);

    if (existing.workflow_run_id) {
      await this.supervisor.workflowSuperviser.cancelRun({ runId: existing.workflow_run_id }).catch(() => undefined);
    }

    const deletedConnections = this.deleteActorConnections(existing.id);
    this.deleteActorInbox(existing.id);

    const deleted = this.db.deleteActorInstance(existing.id);

    if (!deleted) return null;

    for (const connection of deletedConnections) {
      this.publishActorConnectionDeleted(connection);
    }
    this.publishActorInstanceDeleted(deleted, args.reason);
    return deleted;
  }

  private startSandboxWorkerInBackground(): void {
    void this.startSandboxWorker().catch((error) => {
      this.#lastBackgroundSandboxError = error instanceof Error ? error.message : String(error);
      console.error(`[ActorService] Background sandbox worker start failed: ${this.#lastBackgroundSandboxError}`);
    });
  }

  #lastBackgroundSandboxError: string | null = null;

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
    return { db: this.db, idFactory: this.supervisor.idFactory };
  }

  private async nudgeSupervisor(): Promise<void> {
    await this.supervisor.runOnce().catch(() => undefined);
  }

  private deleteActorConnections(actorInstanceId: string): TActorConnectionRow[] {
    return this.db.deleteActorConnectionsForInstance(actorInstanceId);
  }

  private deleteActorInbox(actorInstanceId: string): void {
    this.db.deleteActorInboxForInstance(actorInstanceId);
  }

  private publishActorConnectionDeleted(connection: TActorConnectionRow): void {
    this.eventPublisher?.publishActorEvent(connection.canvas_id, {
      type: 'actor.connection.deleted',
      canvasId: connection.canvas_id,
      connectionId: connection.id,
    });
  }

  private publishActorInstanceUpdated(canvasId: string, actorInstanceId: string): void {
    const instance = this.db.getActorInstance(actorInstanceId);
    if (!instance) return;
    this.eventPublisher?.publishActorEvent(canvasId, { type: 'actor.instance.updated', canvasId, instance });
  }

  private publishActorInstanceDeleted(instance: TActorInstanceRow, reason: string | undefined): void {
    this.eventPublisher?.publishActorEvent(instance.canvas_id, {
      type: 'actor.instance.deleted',
      canvasId: instance.canvas_id,
      instanceId: instance.id,
      reason,
    });
  }
}

function createMissingSandboxRunner(): TActorSandboxRunner {
  return {
    start: async () => {
      throw new Error('ActorService requires an injected sandboxRunner when startSandbox is enabled');
    },
  };
}
