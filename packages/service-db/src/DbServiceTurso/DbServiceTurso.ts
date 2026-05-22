import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { Database } from "@tursodatabase/database"
import type { IDbConfig } from "../interface";
import { txRunMigrations } from "./tx.migrations"

export class DbServiceTurso implements IService, IStartableService, IStoppableService {
  name = 'DbServiceTurso'
  #db: Database

  constructor(private config: IDbConfig) {
    this.#db = new Database(this.config.databasePath, {
      // @ts-expect-error custom_types not typed in turso yet
      experimental: ["custom_types", "triggers", "index_method"],
    })
  }
  async start(): Promise<void> {
    console.log('DbServiceTurso started')
    await this.#db.connect()
  }

  async stop(): Promise<void> {
    console.log('DbServiceTurso stopped')
  }
}
