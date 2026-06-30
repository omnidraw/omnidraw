/* eslint-disable functional-core/import-boundary -- legacy migration tx imports filesystem migration discovery helper */
import { listMigrationFiles } from "./list-migration-files"
import type { Database } from "@tursodatabase/database"
import type path from "node:path"

type TPortal = {
  db: Database,
  Bun: typeof Bun
  path: typeof path
}

type TArgs = {

}

async function txEnsureMigrationTable(portal: TPortal, args: TArgs) {
  await portal.db.exec(`
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT NOT NULL,
  hash_hex TEXT NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
    `)
}

async function listAppliedMigrations(portal: TPortal): Promise<{ name: string; hash_hex: string; applied_at: Date }[]> {
  const stmt = await portal.db.prepare(`SELECT name, hash_hex, applied_at FROM migrations`)
  const result = await stmt.all()
  return result.map((row) => ({
    name: row.name,
    hash_hex: row.hash_hex,
    applied_at: new Date(row.applied_at),
  })).sort((a, b) => a.applied_at.getTime() - b.applied_at.getTime())
}

export async function txRunMigrations(portal: TPortal, args: TArgs) {
  const migrationFiles = listMigrationFiles()
  await txEnsureMigrationTable(portal, args)
  const appliedMigrations = await listAppliedMigrations(portal)
  for (const file of migrationFiles) {
    if(appliedMigrations.some((m) => m.name === file.path)) continue
    if(file.type !== 'sql') continue
    const sqlFile = await portal.Bun.file(file.path).text()
    const hashHex = portal.Bun.hash(sqlFile).toString(16)
    await portal.db.exec(sqlFile).then(async () => {
      const stmt = await portal.db.prepare(`INSERT INTO migrations (name, hash_hex) VALUES (?, ?)`)
      await stmt.run(portal.path.basename(file.path), hashHex)
    })
  }
}
