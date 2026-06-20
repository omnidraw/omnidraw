import type { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import type { IEventPublisherService } from '@vibecanvas/service-event-publisher/IEventPublisherService';
import { fxListVibecanvasJsons } from "./core/fx.vibecanvas-actors";
import { readdir, exists } from "node:fs/promises"
import { join } from "node:path";
import { txEnsureWidgetFolder } from "./core/tx.vibecanvas-widgets";
import { existsSync, mkdirSync } from 'fs';
import type { TVibecanvasJson } from "./core/types";
import { txSyncDbActorDefinitions } from "./core/tx.actor-definitions";

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
        // TODO: show error to user
        return
      }

      this.vibecanvasDefMap[def.vibecanvasJson.name] = {...def.vibecanvasJson, manifest_path: def.vibecanvasJsonPath}
    })

    await txSyncDbActorDefinitions({crypto, db: this.#config.db}, {defs: Object.values(this.vibecanvasDefMap)})

    // console.log('defs', defs, this.#config.configPath)
  }

  async syncDbActorDefinitions(args: {defs: {vibecanvasJson: TVibecanvasJson, vibecanvasJsonPath: string}[]}) {
    const definitionsInDb = await this.#config.db.actor.listDefinitions()
    const defsToInsert: Set<{vibecanvasJson: TVibecanvasJson, vibecanvasJsonPath: string}> = new Set()
    const defsToUpdate: Set<{vibecanvasJson: TVibecanvasJson, vibecanvasJsonPath: string}> = new Set()
    args.defs.forEach(def => {
      if(definitionsInDb.map(d => d.manifest_path).includes(def.vibecanvasJsonPath))
        defsToUpdate.add(def)
      else defsToUpdate.add(def)
    })

    // now we need to do db operations
    const promises: Promise<any>[] = []
    defsToUpdate.forEach(def => {
      const dbDef = definitionsInDb.find(d => d.manifest_path === def.vibecanvasJsonPath)!
      // def.vibecanvasJson.
      const p = this.#config.db.actor.updateDefinition({
        manifest_path: def.vibecanvasJsonPath,
        name: def.vibecanvasJson.name,
        slug: def.vibecanvasJson.slug,
        description: def.vibecanvasJson.description ?? null,
        url: def.vibecanvasJson.url ?? null
      })
      promises.push(p)
    })
    defsToInsert.forEach(def => {
      const p = this.#config.db.actor.insertDefinition({
        description: def.vibecanvasJson.description ?? null,
        manifest_path: def.vibecanvasJsonPath,
        name: def.vibecanvasJson.name,
        slug: def.vibecanvasJson.slug,
        url: def.vibecanvasJson.url ?? null
      })
      promises.push(p)
    })
    await Promise.all(promises)

  }


}
