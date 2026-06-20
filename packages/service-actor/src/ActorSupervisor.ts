import type { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fxListVibecanvasJsons } from "./core/fx.vibecanvas-actors";
import { readdir, exists } from "node:fs/promises"
import { join, dirname } from "node:path";
import { txEnsureWidgetFolder } from "./core/tx.vibecanvas-widgets";
import { existsSync, mkdirSync } from 'fs';
import type { TVibecanvasJson } from "./core/types";
import { txSyncDbActorDefinitions } from "./core/tx.actor-definitions";
import { Actor } from "./Actor";

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
  #actorMap: Record<string, Actor> = {}
  vibecanvasDefMap: {[name: string]: TVibecanvasJson & {manifest_path: string}} = {}


  constructor(config: IActorSupervisorConfig) {
    this.#config = config
    txEnsureWidgetFolder({existsSync, mkdirSync}, {absWidgetDir: this.#config.absWidgetDir})
  }

  async init() {

    // load defs from fs
    // update db, no remove from old defs
    // boot instances from db

    const defs = await fxListVibecanvasJsons({Bun, readdir, join, exists}, {widgetDir: this.#config.absWidgetDir})
    defs.forEach(def => {
      if(def.error !== null) {
        this.#config.eventPublisherService.publishNotification({type: 'error', description: def.error, title: 'Error loading actor definition'})
        return
      }

      this.vibecanvasDefMap[def.vibecanvasJson.name] = {...def.vibecanvasJson, manifest_path: def.vibecanvasJsonPath}
    })

    await txSyncDbActorDefinitions({crypto, db: this.#config.db}, {defs: Object.values(this.vibecanvasDefMap)})

    const instances = await this.#config.db.actor.listInstances()
    instances.forEach(actorInst => {
      const def = this.vibecanvasDefMap[actorInst.actor_definition_name]
      if(!def) return

      const actor = new Actor({
        id: actorInst.id,
        vsJson: def,
        rootDir: dirname(def.manifest_path)
      })

      this.#actorMap[actor.getId()] = actor
    })
  }



  public async createInstance(defId: string, canvasId: string): Promise<void> {

  }


}
