import type { DbServiceTurso } from "packages/service-db/src/DbServiceTurso/DbServiceTurso";
import { fxListVibecanvasJsons } from "./core/fx.vibecanvas-actors";
import { readdir } from "node:fs/promises"
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

  #config: IActorSupervisorConfig

  constructor(config: IActorSupervisorConfig) {
    this.#config = config
  }

  async init() {
    // load defs from fs
    // update db, no remove from old defs
    // boot instances from db

    const defs = await fxListVibecanvasJsons({Bun, readdir }, {configPath: this.#config.configPath})
    console.log('defs', defs, this.#config.configPath)
  }

  async loadActorDefFromFilesystem() {}


}
