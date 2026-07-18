/* eslint-disable functional-core/import-boundary -- legacy migration tx imports filesystem migration discovery helper */
import { listMigrationFiles } from "./list-migration-files"
import type { Database } from "@tursodatabase/database"
import type * as fs from 'node:fs/promises';
import type path from "node:path"

type TPortal = {
  db: Database,
  Bun: typeof Bun
  path: typeof path
  dataDir?: string
  fs?: Pick<typeof fs, 'cp' | 'lstat' | 'mkdir' | 'readFile' | 'readdir' | 'readlink' | 'realpath' | 'rename' | 'rm' | 'rmdir' | 'symlink' | 'writeFile'>
  platform?: NodeJS.Platform
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
  const warnings: string[] = []
  for (const file of migrationFiles) {
    const migrationName = file.name
    if(appliedMigrations.some((m) => m.name === migrationName)) continue
    let hashHex: string
    if (file.type === 'sql') {
      const sqlFile = await portal.Bun.file(file.path).text()
      hashHex = portal.Bun.hash(sqlFile).toString(16)
      const legacyMigration = appliedMigrations.find((migration) => file.legacyNames?.includes(migration.name))
      if (legacyMigration) {
        if (legacyMigration.hash_hex !== hashHex) {
          throw new Error(`Cannot repair renamed migration '${legacyMigration.name}': SQL hash does not match '${migrationName}'.`)
        }
        const rename = await portal.db.prepare(`UPDATE migrations SET name = ? WHERE name = ?`)
        await rename.run(migrationName, legacyMigration.name)
        continue
      }
      await portal.db.exec(sqlFile)
    } else {
      hashHex = portal.Bun.hash(`${file.name}:${file.version}`).toString(16)
      if (portal.dataDir && portal.fs && portal.platform) {
        const result = await file.run({ db: portal.db, dataDir: portal.dataDir, fs: portal.fs, path: portal.path, platform: portal.platform }, {})
        warnings.push(...(result.warnings ?? []).slice(0, Math.max(0, 100 - warnings.length)))
      } else {
        warnings.push(`${file.name}: filesystem portal was not supplied; no agent storage existed in this isolated migration run.`)
      }
    }
    const stmt = await portal.db.prepare(`INSERT INTO migrations (name, hash_hex) VALUES (?, ?)`)
    await stmt.run(migrationName, hashHex)
  }
  return { warnings }
}
