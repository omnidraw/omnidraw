import type { Database } from "@tursodatabase/database"
import type { TFile } from "../model"

type TPortal = {
  db: Database
}

type TArgs = {}

type TArgsGetById = {
  id: string
}

export async function fxFileListAll(portal: TPortal, args: TArgs): Promise<TFile[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM files
  `)
  const rows = await stmt.all()
  return rows as TFile[]
}

export async function fxFileGetById(portal: TPortal, args: TArgsGetById): Promise<TFile | null> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM files
    WHERE id = ?
  `)
  const row = await stmt.get(args.id)
  return (row ?? null) as TFile | null
}
