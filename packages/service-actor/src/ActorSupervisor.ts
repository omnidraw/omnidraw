import type { DbServiceTurso } from "packages/service-db/src/DbServiceTurso/DbServiceTurso";
import { fxListVibecanvasJsons } from "./core/fx.vibecanvas-actors";
import { readdir, exists } from "node:fs/promises"
import { join } from "node:path";
import { txEnsureWidgetFolder } from "./core/tx.vibecanvas-widgets";
import { existsSync, mkdirSync } from 'fs';

interface IPublicMethods {
  init(): Promise<void>;
  sendMessages(msg: any): Promise<void>;
  claimMessage(): Promise<void>;
  processedMessage(): Promise<void>;
  failedMessage(): Promise<void>;
}

interface IActorSupervisorConfig {
  db: DbServiceTurso
  configPath: string
}


export class ActorSupervisor {

  #widgetDir: string;
  #config: IActorSupervisorConfig

  constructor(config: IActorSupervisorConfig) {
    this.#config = config
    this.#widgetDir = join(config.configPath, 'widgets')
    txEnsureWidgetFolder({existsSync, mkdirSync}, {widgetDir: this.#widgetDir})
  }

  async init() {

    // load defs from fs
    // update db, no remove from old defs
    // boot instances from db

    const defs = await fxListVibecanvasJsons({Bun, readdir, join, exists}, {widgetDir: this.#widgetDir})
    console.log('defs', defs, this.#config.configPath)
  }

  async loadActorDefFromFilesystem() {}


}
