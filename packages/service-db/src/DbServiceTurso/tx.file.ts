import type { Database } from "@tursodatabase/database"
import type { TFile } from "../model"
import { fxFileGetById } from "./fx.file"

type TPortal = {
  db: Database
}

type TArgsCreate = Pick<TFile, "id" | "hash" | "mime_type" | "base64">

type TArgsDeleteById = {
  id: string
}

export async function txFileCreate(portal: TPortal, args: TArgsCreate): Promise<TFile> {
  const stmt = await portal.db.prepare(`
    INSERT INTO files (id, hash, mime_type, base64)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.id, args.hash, args.mime_type, args.base64)

  if (!row) {
    throw new Error("Failed to create file record")
  }

  return row as TFile
}

export async function txFileDeleteById(portal: TPortal, args: TArgsDeleteById): Promise<void> {
  const existing = await fxFileGetById(portal, args)

  if (!existing) {
    return
  }

  const stmt = await portal.db.prepare(`
    DELETE FROM files
    WHERE id = ?
  `)
  await stmt.run(args.id)
}
