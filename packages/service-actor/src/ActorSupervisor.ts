import type { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import type { TActorConnection, TActorInstance, TWidgetError } from "@vibecanvas/service-db/model";
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fxListVibecanvasJsons } from "./core/fx.vibecanvas-actors";
import { readdir, exists, rm } from "node:fs/promises"
import { dirname, isAbsolute, join, relative } from "node:path";
import { txEnsureWidgetFolder } from "./core/tx.vibecanvas-widgets";
import { existsSync, mkdirSync } from 'fs';
import type { TActorData, TActorState, TVibecanvasJson } from "./core/types";
import { fnCanRouteActorConnectionMessage, fnIsActorConnectionEnabled } from "./core/fn.actor-connections";
import { fnToActorData } from "./core/fn.actor-data";
import { txDeleteActorDefinitionFiles, txSyncDbActorDefinitions } from "./core/tx.actor-definitions";
import { Actor, type TActorEvent } from "./Actor";
import { fnNormalizeWidgetError } from './core/fn.widget-error';
import type { TActorResourceGateway, TActorStartAdmission } from './resources/resource-types';

function resolveManifestPath(configPath: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? manifestPath : join(configPath, manifestPath)
}

function makeManifestPathConfigRelative(configPath: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? relative(configPath, manifestPath) : manifestPath
}

interface IPublicMethods { // not in use yet
  init(): Promise<void>;
  reload(): Promise<void>;
  sendMessages(msg: any): Promise<void>;
  claimMessage(): Promise<void>;
  processedMessage(): Promise<void>;
  failedMessage(): Promise<void>;
  createInstance(defId: string, canvasId: string): Promise<void>
  removeInstance(instanceId: string): Promise<void>
  deleteDefinition(defName: string): Promise<boolean>

}

interface IActorSupervisorConfig {
  db: DbServiceTurso
  absWidgetDir: string
  configPath: string
  eventPublisherService: IEventPublisherService
  resourceGateway?: TActorResourceGateway
  actorStartAdmission?: (args: {
    definitionName: string
    actorInstanceId: string
    restartIfCompatible: boolean
  }) => Promise<TActorStartAdmission>
  actorStartSucceeded?: (args: { actorInstanceId: string; resourceIds: readonly string[] }) => Promise<void>
}

export class ActorSupervisor {

  #config: IActorSupervisorConfig
  actorMap: Record<string, Actor> = {}
  connectionMap: Record<string, TActorConnection[]> = {}
  vibecanvasDefMap: { [name: string]: TVibecanvasJson & { manifest_path: string } } = {}
  #snapshotPersistenceRevision = new Map<string, number>()
  #snapshotPersistenceTail = new Map<string, Promise<void>>()


  constructor(config: IActorSupervisorConfig) {
    this.#config = config
    txEnsureWidgetFolder({ existsSync, mkdirSync }, { absWidgetDir: this.#config.absWidgetDir })
  }

  async init() {
    this.closeActors()
    await this.reload()
  }

  async reload() {
    await this.reloadDefinitions()
    const definitionSyncErrors = await txSyncDbActorDefinitions({
      crypto,
      db: this.#config.db,
      configPath: this.#config.configPath,
      isAbsolute,
      relative,
    }, { defs: Object.values(this.vibecanvasDefMap) })
    definitionSyncErrors.forEach((error) => {
      this.#config.eventPublisherService.publishNotification({
        type: 'error',
        title: 'Failed to synchronize widget definition',
        description: error instanceof Error ? error.message : String(error),
      })
    })
    await this.loadMissingActorInstances()
    await this.reloadConnections()
  }

  async reloadDefinitionInstances(defName: string) {
    const def = this.vibecanvasDefMap[defName]
    if (!def) return

    const instances = await this.#config.db.actor.listInstances()
    const matchingInstances = instances.filter((instance) => instance.actor_definition_name === defName)

    for (const instance of matchingInstances) {
      const actor = this.actorMap[instance.id]
      if (!actor && instance.status === 'stopped') {
        continue
      }
      if (!actor && instance.status === 'blocked') {
        await this.loadActorInstance(instance, { respectPersistedStop: true })
        continue
      }
      if (actor) {
        actor.close()
        delete this.actorMap[instance.id]
      }

      await this.#config.db.actor.updateInstanceMachine({
        id: instance.id,
        machine_state: def.actor.initialState,
        machine_context: def.actor.initialData,
      })
      await this.#config.db.actor.updateInstanceStatus({ id: instance.id, status: 'created' })
      await this.loadActorInstance({
        ...instance,
        machine_state: def.actor.initialState,
        machine_context: def.actor.initialData,
        status: 'created',
      })
    }

    if (matchingInstances.length > 0) {
      this.#config.eventPublisherService.publishNotification({
        type: 'success',
        title: 'Widget instances reloaded',
        description: `Reloaded ${matchingInstances.length} instance(s) for ${defName}.`,
      })
    }
  }

  private async reloadDefinitions() {
    const nextDefMap: { [name: string]: TVibecanvasJson & { manifest_path: string } } = {}
    const defs = await fxListVibecanvasJsons({ Bun, readdir, join, exists }, { widgetDir: this.#config.absWidgetDir })

    defs.forEach(def => {
      if (def.error !== null) {
        this.#config.eventPublisherService.publishNotification({ type: 'error', description: def.error, title: 'Error loading actor definition' })
        return
      }

      def.warnings.forEach((warning) => {
        this.#config.eventPublisherService.publishNotification({
          type: 'info',
          title: 'Legacy actor manifest behavior',
          description: warning,
        })
      })

      nextDefMap[def.vibecanvasJson.name] = {
        ...def.vibecanvasJson,
        manifest_path: makeManifestPathConfigRelative(this.#config.configPath, def.vibecanvasJsonPath),
      }
    })

    this.vibecanvasDefMap = nextDefMap
  }

  private async loadMissingActorInstances() {
    const instances = await this.#config.db.actor.listInstances()

    for (const actorInst of instances) {
      if (this.actorMap[actorInst.id]) continue
      await this.loadActorInstance(actorInst, { respectPersistedStop: true })
    }
  }

  private async persistInstanceError(actorInst: TActorInstance, error: TWidgetError, publishEvent = true) {
    try {
      await this.#config.db.actor.updateInstanceHealth({ id: actorInst.id, status: 'error', last_error: error })
    } catch (persistError) {
      this.#config.eventPublisherService.publishNotification({
        type: 'error',
        title: 'Failed to persist widget error',
        description: persistError instanceof Error ? persistError.message : String(persistError),
      })
    }

    if (publishEvent) {
      this.#config.eventPublisherService.publishActorEvent({
        kind: 'system',
        actorId: actorInst.id,
        type: 'error',
        code: error.code,
        message: error.message,
        details: error.details,
      })
    }
    this.#config.eventPublisherService.publishNotification({
      type: 'error',
      title: 'Error loading widget',
      description: `${actorInst.display_name}: ${error.message}`,
    })
  }

  private async loadActorInstance(
    actorInst: TActorInstance,
    options: { respectPersistedStop?: boolean } = {},
  ): Promise<Actor | null> {
    const def = this.vibecanvasDefMap[actorInst.actor_definition_name]
    if (!def) {
      await this.persistInstanceError(actorInst, {
        phase: 'definition-fetch',
        code: 'WIDGET_DEFINITION_UNAVAILABLE',
        message: `Widget definition "${actorInst.actor_definition_name}" is unavailable.`,
        retryable: true,
        occurredAt: new Date().toISOString(),
      })
      return null
    }

    let admission: TActorStartAdmission | null = null
    if (this.#config.actorStartAdmission) {
      admission = await this.#config.actorStartAdmission({
        definitionName: actorInst.actor_definition_name,
        actorInstanceId: actorInst.id,
        restartIfCompatible: actorInst.status === 'created' || actorInst.status === 'running' || actorInst.status === 'starting',
      })
      if (!admission.allowed) {
        await this.#config.db.actor.updateInstanceHealth({
          id: actorInst.id,
          status: 'blocked',
          last_error: {
            phase: 'instance-start',
            code: admission.code ?? 'DB_RESOURCE_UNAVAILABLE',
            message: admission.message ?? 'Actor start is blocked by a database resource lifecycle operation.',
            retryable: true,
            occurredAt: new Date().toISOString(),
          },
        })
        return null
      }
      if (admission.hadBlocks && !admission.shouldRestart) {
        await this.#config.db.actor.updateInstanceHealth({ id: actorInst.id, status: 'stopped', last_error: null })
        return null
      }
      if (
        options.respectPersistedStop
        && (actorInst.status === 'stopped' || actorInst.status === 'blocked')
        && !admission.shouldRestart
      ) {
        return null
      }
    } else if (
      options.respectPersistedStop
      && (actorInst.status === 'stopped' || actorInst.status === 'blocked')
    ) {
      return null
    }

    let actor: Actor | null = null
    try {
      await this.#config.db.actor.updateInstanceHealth({ id: actorInst.id, status: 'starting', last_error: null })
      if (this.#config.actorStartAdmission) {
        const finalAdmission = await this.#config.actorStartAdmission({
          definitionName: actorInst.actor_definition_name,
          actorInstanceId: actorInst.id,
          restartIfCompatible: admission?.shouldRestart ?? false,
        })
        if (!finalAdmission.allowed) {
          await this.#config.db.actor.updateInstanceHealth({
            id: actorInst.id,
            status: 'blocked',
            last_error: {
              phase: 'instance-start',
              code: finalAdmission.code ?? 'DB_RESOURCE_UNAVAILABLE',
              message: finalAdmission.message ?? 'Actor start is blocked by a database resource lifecycle operation.',
              retryable: true,
              occurredAt: new Date().toISOString(),
            },
          })
          return null
        }
        admission = finalAdmission
      }
      this.#snapshotPersistenceRevision.delete(actorInst.id)
      actor = new Actor({
        id: actorInst.id,
        vsJson: def,
        rootDir: dirname(resolveManifestPath(this.#config.configPath, def.manifest_path)),
        state: actorInst.machine_state as TActorState,
        data: fnToActorData(actorInst.machine_context),
        resourceGateway: this.#config.resourceGateway,
      })

      this.actorMap[actor.getId()] = actor
      this.listenToActor(actor)
      actor.start()
      await actor.waitUntilReady()
      await this.#config.db.actor.updateInstanceHealth({ id: actor.getId(), status: 'running', last_error: null })
      if (admission && admission.resolvedBlockResourceIds.length > 0) {
        await this.#config.actorStartSucceeded?.({
          actorInstanceId: actor.getId(),
          resourceIds: admission.resolvedBlockResourceIds,
        })
      }
      return actor
    } catch (cause) {
      if (actor) {
        try { actor.close() } catch { /* best-effort cleanup */ }
        delete this.actorMap[actor.getId()]
      }
      await this.persistInstanceError(actorInst, fnNormalizeWidgetError(cause, {
        phase: 'instance-start',
        code: 'ACTOR_INSTANCE_START_FAILED',
        retryable: true,
        occurredAt: new Date().toISOString(),
      }))
      return null
    }
  }

  private async reloadConnections() {
    const nextConnectionMap: Record<string, TActorConnection[]> = {}
    const connections = await this.#config.db.actor.listConnections()

    connections.forEach(connection => {
      if (!nextConnectionMap[connection.source_actor_instance_id]) {
        nextConnectionMap[connection.source_actor_instance_id] = []
      }

      nextConnectionMap[connection.source_actor_instance_id].push(connection)
    })

    this.connectionMap = nextConnectionMap
  }

  listenToActor(actor: Actor) {
    actor.listen((event) => {
      this.#config.eventPublisherService.publishActorEvent(event as any)

      if (event.kind === "system" && event.type === "snapshot") {
        this.queueActorMachineSnapshot(actor.getId(), event)
        return
      }

      if (event.kind === 'system' && event.type === 'error' && event.code === 'ACTOR_CHILD_EXITED') {
        void this.persistRuntimeActorError(actor, event)
        return
      }

      if (event.kind !== "actor") return

      void this.routeActorOutput({
        sourceActorInstanceId: actor.getId(),
        msgName: event.name,
        msgPayload: event.payload,
      })
    })
  }

  private async persistRuntimeActorError(actor: Actor, event: Extract<TActorEvent, { kind: 'system'; type: 'error' }>) {
    const instance = await this.#config.db.actor.getInstanceById(actor.getId())
    if (!instance) return
    await this.persistInstanceError(instance, {
      phase: 'sandbox-runtime',
      code: event.code,
      message: event.message,
      details: event.details as TWidgetError['details'],
      retryable: true,
      occurredAt: new Date().toISOString(),
    }, false)
  }

  private queueActorMachineSnapshot(actorId: string, event: Extract<TActorEvent, { kind: 'system'; type: 'snapshot' }>) {
    const latestRevision = this.#snapshotPersistenceRevision.get(actorId) ?? 0
    if (event.revision <= latestRevision) return
    this.#snapshotPersistenceRevision.set(actorId, event.revision)

    const previous = this.#snapshotPersistenceTail.get(actorId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.persistActorMachineSnapshot(actorId, event.state, event.data))
    this.#snapshotPersistenceTail.set(actorId, next)
    void next.finally(() => {
      if (this.#snapshotPersistenceTail.get(actorId) === next) {
        this.#snapshotPersistenceTail.delete(actorId)
      }
    })
  }

  private async persistActorMachineSnapshot(actorId: string, state: TActorState, data: TActorData) {
    try {
      await this.#config.db.actor.updateInstanceMachine({
        id: actorId,
        machine_state: state,
        machine_context: data,
      })
    } catch (error) {
      this.#config.eventPublisherService.publishNotification({
        type: 'error',
        title: 'Failed to persist actor instance',
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  listenToActorEvents(actorId: string, cb: (event: TActorEvent) => void) {
    const actor = this.actorMap[actorId]
    if (!actor) return null
    return actor.listen(cb)
  }

  async routeActorOutput(args: { sourceActorInstanceId: string, msgName: string, msgPayload: any }) {
    const connections = this.connectionMap[args.sourceActorInstanceId] ?? []
    connections.forEach(connection => {
      if (!fnIsActorConnectionEnabled(connection)) return
      if (!fnCanRouteActorConnectionMessage(connection, args.msgName)) return

      const targetActor = this.actorMap[connection.target_actor_instance_id]
      if (!targetActor) return

      targetActor.inbox(args.msgName, args.msgPayload)
    })
  }

  closeActors() {
    Object.values(this.actorMap).forEach(actor => actor.close())
    this.actorMap = {}
    this.connectionMap = {}
    this.#snapshotPersistenceRevision.clear()
  }

  public async createInstance(defName: string, canvasId: string, elementId: string): Promise<Actor | null> {
    const def = this.vibecanvasDefMap[defName]
    if (!def) {
      this.#config.eventPublisherService.publishNotification({
        type: 'error',
        title: 'Widget not found',
        description: defName
      })
      return null
    }

    const actorDb = await this.#config.db.actor.insertInstance({
      id: crypto.randomUUID(),
      actor_definition_name: def.name,
      canvas_id: canvasId,
      display_name: def.name,
      element_id: elementId,
      filesystem_id: null,
      status: 'created',
      machine_state: def.actor.initialState,
      machine_context: def.actor.initialData
    })

    return this.loadActorInstance(actorDb)
  }

  public async removeInstance(instanceId: string): Promise<void> {
    const actor = this.actorMap[instanceId]
    if (actor) {
      await this.#config.db.actor.updateInstanceStatus({id: actor.getId(), status: 'stopping'})
      actor.close()
      await this.#config.db.actor.updateInstanceStatus({id: actor.getId(), status: 'stopped'})
      delete this.actorMap[instanceId]
    }

    delete this.connectionMap[instanceId]
    for (const [sourceActorInstanceId, connections] of Object.entries(this.connectionMap)) {
      const remainingConnections = connections.filter(connection => connection.target_actor_instance_id !== instanceId)
      if (remainingConnections.length === 0) {
        delete this.connectionMap[sourceActorInstanceId]
        continue
      }

      this.connectionMap[sourceActorInstanceId] = remainingConnections
    }

    await this.#config.db.actor.deleteInstance(instanceId)
  }

  public isInstanceRunning(instanceId: string): boolean {
    return this.actorMap[instanceId] !== undefined
  }

  public async stopInstanceForResourceMigration(instanceId: string): Promise<boolean> {
    const actor = this.actorMap[instanceId]
    if (!actor) return false
    await this.#config.db.actor.updateInstanceStatus({ id: instanceId, status: 'stopping' })
    const stopped = await actor.closeAndWait()
    delete this.actorMap[instanceId]
    if (!stopped) {
      await this.#config.db.actor.updateInstanceStatus({ id: instanceId, status: 'error' })
      return false
    }
    await this.#config.db.actor.updateInstanceStatus({ id: instanceId, status: 'blocked' })
    return true
  }

  public async restartInstanceAfterResourceMigration(instanceId: string): Promise<Actor | null> {
    if (this.actorMap[instanceId]) return this.actorMap[instanceId]
    const instance = await this.#config.db.actor.getInstanceById(instanceId)
    if (!instance) return null
    await this.#config.db.actor.updateInstanceStatus({ id: instanceId, status: 'created' })
    return this.loadActorInstance({ ...instance, status: 'created' })
  }

  public async deleteDefinition(defName: string): Promise<boolean> {
    const def = this.vibecanvasDefMap[defName]
    if (!def) {
      return false
    }

    const instances = await this.#config.db.actor.listInstances()
    const matchingInstances = instances.filter((instance) => instance.actor_definition_name === defName)
    for (const instance of matchingInstances) {
      await this.removeInstance(instance.id)
    }

    await txDeleteActorDefinitionFiles({
      dirname,
      rm,
    }, {
      absManifestPath: resolveManifestPath(this.#config.configPath, def.manifest_path),
    })
    await this.#config.db.actor.deleteDefinition(defName)
    delete this.vibecanvasDefMap[defName]
    await this.reloadConnections()

    this.#config.eventPublisherService.publishNotification({
      type: 'success',
      title: 'Widget deleted',
      description: `Deleted ${defName}.`,
    })

    return true
  }


}
