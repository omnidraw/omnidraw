import type { Database } from "@tursodatabase/database"
import type { TMediaFile } from "../model"

type TPortal = {
  db: Database
}

type TArgs = {}

type TArgsGetById = {
  id: string
}

export async function fxFileListAll(portal: TPortal, args: TArgs): Promise<TMediaFile[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM media_files
  `)
  const rows = await stmt.all()
  return rows as TMediaFile[]
}

export async function fxFileGetById(portal: TPortal, args: TArgsGetById): Promise<TMediaFile | null> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM media_files
    WHERE id = ?
  `)
  const row = await stmt.get(args.id)
  return (row ?? null) as TMediaFile | null
}
