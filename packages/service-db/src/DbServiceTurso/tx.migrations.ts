import { listMigrationFiles } from "./list-migration-files"
import { Database } from "@tursodatabase/database"

type TPortal = {
  db: Database,
  Bun: typeof Bun
}

type TArgs = {

}

export async function txRunMigrations(portal: TPortal, args: TArgs) {
  const migrationFiles = listMigrationFiles()
  for (const file of migrationFiles) {
    if(file.type !== 'sql') continue
    const sqlFile = await portal.Bun.file(file.path).text()
    await portal.db.exec(sqlFile)
  }
}
