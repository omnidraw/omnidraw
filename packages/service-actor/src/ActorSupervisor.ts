import type { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import type { TActorConnection } from "@vibecanvas/service-db/model";
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fxListVibecanvasJsons } from "./core/fx.vibecanvas-actors";
import { readdir, exists } from "node:fs/promises"
import { join, dirname } from "node:path";
import { txEnsureWidgetFolder } from "./core/tx.vibecanvas-widgets";
import { existsSync, mkdirSync } from 'fs';
import type { TActorState, TVibecanvasJson } from "./core/types";
import { fnCanRouteActorConnectionMessage, fnIsActorConnectionEnabled } from "./core/fn.actor-connections";
import { fnToActorData } from "./core/fn.actor-data";
import { txSyncDbActorDefinitions } from "./core/tx.actor-definitions";
import { Actor, type TActorEvent } from "./Actor";

interface IPublicMethods { // not in use yet
  init(): Promise<void>;
  sendMessages(msg: any): Promise<void>;
  claimMessage(): Promise<void>;
  processedMessage(): Promise<void>;
  failedMessage(): Promise<void>;
  createInstance(defId: string, canvasId: string): Promise<void>
  removeInstance(instanceId: string): Promise<void>

}

interface IActorSupervisorConfig {
  db: DbServiceTurso
  absWidgetDir: string
  eventPublisherService: IEventPublisherService
}

export class ActorSupervisor {

  #config: IActorSupervisorConfig
  actorMap: Record<string, Actor> = {}
  connectionMap: Record<string, TActorConnection[]> = {}
  vibecanvasDefMap: { [name: string]: TVibecanvasJson & { manifest_path: string } } = {}


  constructor(config: IActorSupervisorConfig) {
    this.#config = config
    txEnsureWidgetFolder({ existsSync, mkdirSync }, { absWidgetDir: this.#config.absWidgetDir })
  }

  async init() {
    this.closeActors()
    this.connectionMap = {}
    this.vibecanvasDefMap = {}

    // load defs from fs
    // update db, no remove from old defs
    // boot instances from db

    const defs = await fxListVibecanvasJsons({ Bun, readdir, join, exists }, { widgetDir: this.#config.absWidgetDir })
    defs.forEach(def => {
      if (def.error !== null) {
        this.#config.eventPublisherService.publishNotification({ type: 'error', description: def.error, title: 'Error loading actor definition' })
        return
      }

      this.vibecanvasDefMap[def.vibecanvasJson.name] = { ...def.vibecanvasJson, manifest_path: def.vibecanvasJsonPath }
    })

    await txSyncDbActorDefinitions({ crypto, db: this.#config.db }, { defs: Object.values(this.vibecanvasDefMap) })

    const instances = await this.#config.db.actor.listInstances()
    instances.forEach(async actorInst => {
      const def = this.vibecanvasDefMap[actorInst.actor_definition_name]
      if (!def) return

      const actor = new Actor({
        id: actorInst.id,
        vsJson: def,
        rootDir: dirname(def.manifest_path),
        state: actorInst.machine_state as TActorState,
        data: fnToActorData(actorInst.machine_context),
      })

      this.actorMap[actor.getId()] = actor
      this.listenToActor(actor)
      actor.start()
      await this.#config.db.actor.updateInstanceStatus({id: actor.getId(), status: 'running'})
    })

    const connections = await this.#config.db.actor.listConnections()
    connections.forEach(connection => {
      if (!this.connectionMap[connection.source_actor_instance_id]) {
        this.connectionMap[connection.source_actor_instance_id] = []
      }

      this.connectionMap[connection.source_actor_instance_id].push(connection)
    })
  }

  listenToActor(actor: Actor) {
    actor.listen((event) => {
      this.#config.eventPublisherService.publishActorEvent(event as any)
      if (event.kind !== "actor") return

      void this.routeActorOutput({
        sourceActorInstanceId: actor.getId(),
        msgName: event.name,
        msgPayload: event.payload,
      })
    })
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

    const actor = new Actor({
      id: actorDb.id,
      vsJson: def,
      rootDir: dirname(def.manifest_path),
    })

    this.actorMap[actor.getId()] = actor
    this.listenToActor(actor)
    actor.start()
    await this.#config.db.actor.updateInstanceStatus({id: actor.getId(), status: 'running'})
    return actor;
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


}
