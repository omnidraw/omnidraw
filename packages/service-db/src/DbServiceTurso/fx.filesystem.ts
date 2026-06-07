import type { Database } from "@tursodatabase/database"
import type { TFilesystem } from "../model"

type TPortal = {
  db: Database
}

type TArgs = {}

type TArgsFindById = {
  id: string
}

export async function fxFilesystemListAll(portal: TPortal, args: TArgs): Promise<TFilesystem[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM file_systems
  `)
  const rows = await stmt.all()
  return rows as TFilesystem[]
}

export async function fxFilesystemFindById(portal: TPortal, args: TArgsFindById): Promise<TFilesystem | null> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM file_systems
    WHERE id = ?
  `)
  const row = await stmt.get(args.id)
  return (row ?? null) as TFilesystem | null
}
