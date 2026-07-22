import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { IServiceContext } from '@vibecanvas/runtime/interface.ts';
import type {
  IResourceUseCoordinator,
  TResourceDrainLease,
  TResourceDrainRequest,
  TResourceDrainResult,
  TResourceReleaseMode,
  TResourceReleaseResult,
  TResourceUse,
  TResourceUseInspection,
} from '@vibecanvas/resource-runtime';
import type { TTenantDb } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import type { ITenantEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative as relativePath } from 'node:path';
import { ActorSupervisor } from './ActorSupervisor';
import { txGetWidgetCode } from './core/tx.actor-definitions';
import type { TVibecanvasJson } from './core/types';
import type { Actor, TActorEvent } from './Actor';
import type {
  TActorResourceCall,
  TActorResourceDirectBinding,
  TActorStartAdmission,
} from './legacy/resource-protocol';

type TTenantContext = Parameters<IResourceUseCoordinator['inspect']>[0];

function resolveManifestPath(configPath: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? manifestPath : join(configPath, manifestPath)
}

interface IPublicMethods {
  sendMessage(instanceId: string, msgName: string, msgPayload: any): Promise<string>
  listenToActorEvents(instanceId: string, cb: (event: TActorEvent) => void): (() => void) | null
  createInstance(defId: string, canvasId: string, elementId: string): Promise<Actor | null>
  removeInstance(instanceId: string): Promise<void>
  deleteDefinition(defName: string): Promise<boolean>
  getVibecanvasJson(defId: string): TVibecanvasJson | null;
  getWidgetCode(defId: string): Promise<{content: string, path: string}[] | null>
  callWithDirectResourceBinding(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown>
}

export interface IActorServiceConfig {
  db: TTenantDb;
  configPath: string;
  crypto?: Pick<Crypto, 'randomUUID'>;
  resourceService: IActorResourceService;
  eventPublisherService: ITenantEventPublisherService,
}

export type TActorServiceDiagnostics = Readonly<{
  activeProcessCount: number;
}>;

type TActorResourceRuntimeBridge = Readonly<{
  getActorStartAdmission(args: {
    definitionName: string;
    actorInstanceId: string;
    restartIfCompatible: boolean;
  }): Promise<TActorStartAdmission>;
  completeActorStart(args: {
    actorInstanceId: string;
    resourceIds: readonly string[];
    succeeded: boolean;
  }): Promise<void>;
  call(call: TActorResourceCall): Promise<unknown>;
  callWithDirectResourceBinding(
    call: TActorResourceCall,
    binding: TActorResourceDirectBinding,
  ): Promise<unknown>;
}>;

/** Minimal actor runtime bridge implemented by the actor-independent Resource Service. */
export type IActorResourceService = TActorResourceRuntimeBridge
  & Readonly<{
    attachConsumer?(consumer: Pick<ActorService, 'getVibecanvasJson'>): (() => void) | void;
  }>;

export class ActorService implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'actor-service'
  #config: IActorServiceConfig
  #supervisor: ActorSupervisor
  readonly #resourceService: IActorResourceService
  #resourceConsumerDetach: (() => void) | null = null
  readonly #stopCleanups = new Set<() => void>()
  #resourceUseLeaseEpoch = 0

  constructor(config: IActorServiceConfig) {
    this.#config = config
    this.#resourceService = config.resourceService
    this.#supervisor = new ActorSupervisor({
      absWidgetDir: join(config.configPath, 'widgets'),
      configPath: config.configPath,
      crypto: config.crypto ?? crypto,
      db: config.db,
      eventPublisherService: config.eventPublisherService,
      resourceGateway: (call) => this.#callResource(call),
      actorStartAdmission: (args) => this.#getActorStartAdmission(args),
      actorStartCompleted: (args) => this.#completeActorStart(args),
    })
    this.#resourceConsumerDetach = config.resourceService.attachConsumer?.(this) ?? null
  }

  callWithDirectResourceBinding(call: TActorResourceCall, binding: TActorResourceDirectBinding): Promise<unknown> {
    return this.#resourceService.callWithDirectResourceBinding(call, binding)
  }

  async start(ctx: IServiceContext<object, object>): Promise<void> {
    void ctx
    console.log('start', this.name)
    try {
      await this.#clearObsoleteDbResourceErrors()
      await this.#supervisor.init()
    } catch (error) {
      try {
        await this.#supervisor.closeActors()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'ActorService startup and actor cleanup failed.')
      }
      throw error
    }
  }

  async stop(): Promise<void> {
    console.log('stop', this.name)
    let failure: unknown = null
    let actorsStopped = false
    const run = async (operation: (() => void | Promise<void>) | undefined): Promise<void> => {
      if (!operation) return
      try {
        await operation()
      } catch (error) {
        failure ??= error
      }
    }
    try {
      await this.#supervisor.closeActors()
      actorsStopped = true
    } catch (error) {
      failure ??= error
    }
    const resourceConsumerDetach = this.#resourceConsumerDetach
    this.#resourceConsumerDetach = null
    await run(resourceConsumerDetach ?? undefined)
    if (actorsStopped) {
      const stopCleanups = [...this.#stopCleanups]
      this.#stopCleanups.clear()
      for (const cleanup of stopCleanups) await run(cleanup)
    }
    if (failure !== null) throw failure
  }

  addStopCleanup(cleanup: () => void): void {
    this.#stopCleanups.add(cleanup)
  }

  diagnostics(): TActorServiceDiagnostics {
    return {
      activeProcessCount: this.#supervisor.getActiveProcessCount(),
    }
  }

  async createInstance(defName: string, canvasId: string, elementId: string): Promise<Actor | null> {
    return this.#supervisor.createInstance(defName, canvasId, elementId)
  }

  async removeInstance(instanceId: string): Promise<void> {
    return this.#supervisor.removeInstance(instanceId)
  }

  async deleteDefinition(defName: string): Promise<boolean> {
    return this.#supervisor.deleteDefinition(defName)
  }

  async sendMessage(instanceId: string, msgName: string, msgPayload: any): Promise<string> {
    const actor = this.#supervisor.actorMap[instanceId]
    if (!actor) throw new Error(`Actor instance not found: ${instanceId}`)
    return actor.inbox(msgName, msgPayload)
  }

  listenToActorEvents(instanceId: string, cb: (event: TActorEvent) => void): (() => void) | null {
    return this.#supervisor.listenToActorEvents(instanceId, cb)
  }

  getVibecanvasJson(defName: string) {
    return this.#supervisor.vibecanvasDefMap[defName] ?? null
  }

  async getWidgetCode(defName: string): Promise<{ content: string; path: string; }[] | null> {
    const vcJson = this.getVibecanvasJson(defName)
    if (vcJson === null) return null
    const absManifestPath = resolveManifestPath(this.#config.configPath, vcJson.manifest_path)
    const absWidgetDir = join(dirname(absManifestPath), vcJson.widget.relWidgetDir)

    return txGetWidgetCode({Bun, readdir, join, relative: relativePath}, {absWidgetDir})
  }

  async inspectResourceUses(resourceId: string): Promise<TResourceUseInspection> {
    const instances = await this.#config.db.dbResource.listAffectedInstances({ resourceId })
    return {
      resourceId,
      uses: instances.flatMap((instance): readonly TResourceUse[] => (
        this.#supervisor.isInstanceRunning(instance.id)
          ? [{
              id: instance.id,
              kind: 'legacy-actor',
              state: 'active',
              label: instance.actor_definition_name,
            }]
          : []
      )),
    }
  }

  async drainResourceUses(request: TResourceDrainRequest): Promise<TResourceDrainResult> {
    const inspection = await this.inspectResourceUses(request.resourceId)
    const drainedUses: TResourceUse[] = []
    for (const use of inspection.uses) {
      if (!await this.#supervisor.stopInstanceForResourceApply(use.id)) {
        await this.#resumeResourceUses(drainedUses)
        return {
          ok: false,
          code: 'RESOURCE_DRAIN_TIMEOUT',
          inspection: await this.inspectResourceUses(request.resourceId),
        }
      }
      drainedUses.push({ ...use, state: 'stopped' })
    }
    this.#resourceUseLeaseEpoch += 1
    return {
      ok: true,
      lease: {
        resourceId: request.resourceId,
        leaseId: `legacy-actor-resource:${this.#resourceUseLeaseEpoch}`,
        leaseEpoch: this.#resourceUseLeaseEpoch,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
        drainedUses,
      },
    }
  }

  async releaseResourceUses(
    lease: TResourceDrainLease,
    mode: TResourceReleaseMode,
  ): Promise<TResourceReleaseResult> {
    const resumedUseIds = mode === 'resume'
      ? await this.#resumeResourceUses(lease.drainedUses)
      : []
    return {
      resourceId: lease.resourceId,
      released: true,
      mode,
      resumedUseIds,
    }
  }

  #callResource(call: TActorResourceCall): Promise<unknown> {
    return this.#resourceService.call(call)
  }

  #getActorStartAdmission(
    args: Parameters<TActorResourceRuntimeBridge['getActorStartAdmission']>[0],
  ): ReturnType<TActorResourceRuntimeBridge['getActorStartAdmission']> {
    return this.#resourceService.getActorStartAdmission(args)
  }

  #completeActorStart(
    args: Parameters<TActorResourceRuntimeBridge['completeActorStart']>[0],
  ): ReturnType<TActorResourceRuntimeBridge['completeActorStart']> {
    return this.#resourceService.completeActorStart(args)
  }

  async #clearObsoleteDbResourceErrors(): Promise<void> {
    const obsoleteCodes = new Set([
      'DB_RESOURCE_SCHEMA_MISMATCH',
      'DB_RESOURCE_VERSION_MISMATCH',
      'DB_RESOURCE_MIGRATION_CHANGED',
      'DB_RESOURCE_MIGRATION_FAILED',
    ])
    const instances = await this.#config.db.actor.listInstances()
    for (const instance of instances) {
      const code = instance.last_error && typeof instance.last_error === 'object' && !Array.isArray(instance.last_error)
        ? (instance.last_error as { code?: unknown }).code
        : null
      if (typeof code !== 'string' || !obsoleteCodes.has(code)) continue
      await this.#config.db.actor.updateInstanceHealth({
        id: instance.id,
        status: instance.status === 'blocked' ? 'stopped' : instance.status,
        last_error: null,
      })
    }
  }

  async #resumeResourceUses(uses: readonly TResourceUse[]): Promise<string[]> {
    const resumedUseIds: string[] = []
    for (const use of uses) {
      try {
        const actor = await this.#supervisor.restartInstanceAfterResourceApply(use.id)
        if (actor !== null && this.#supervisor.isInstanceRunning(use.id)) resumedUseIds.push(use.id)
      } catch {
        // The neutral release result reports only successfully resumed uses.
      }
    }
    return resumedUseIds
  }

}
