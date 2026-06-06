import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { Database } from "@tursodatabase/database"
import type { IDbConfig } from "../interface";
import { txRunMigrations } from "./tx.migrations"
import { txDefaultRunPragmas } from "./tx.pragma";
import path from "node:path";

export class DbServiceTurso implements IService, IStartableService, IStoppableService {
  name = 'DbServiceTurso'
  db: Database

  constructor(private config: IDbConfig) {
    this.db = new Database(this.config.databasePath, {
      // @ts-expect-error experimental feature list is ahead of package typings
      experimental: ["custom_types", "triggers", "index_method", "multiprocess_wal"],
    })
  }
  async start(): Promise<void> {
    console.log('DbServiceTurso started')
    await this.db.connect()
    await txDefaultRunPragmas({ db: this.db }, {})
    await txRunMigrations({ db: this.db, Bun, path }, {})
  }

  async stop(): Promise<void> {
    console.log('DbServiceTurso stopped')
  }
}
