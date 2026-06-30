import type { Database } from "@tursodatabase/database"
import type { TMediaFile } from "../model"
import { fxFileGetById } from "./fx.file"

type TPortal = {
  db: Database
}

type TArgsCreate = Pick<TMediaFile, "id" | "hash" | "mime_type" | "data">

type TArgsDeleteById = {
  id: string
}

export async function txFileCreate(portal: TPortal, args: TArgsCreate): Promise<TMediaFile> {
  const stmt = await portal.db.prepare(`
    INSERT INTO media_files (id, hash, mime_type, data)
    VALUES (?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.id, args.hash, args.mime_type, args.data)

  if (!row) {
    throw new Error("Failed to create media file record")
  }

  return row as TMediaFile
}

export async function txFileDeleteById(portal: TPortal, args: TArgsDeleteById): Promise<void> {
  const existing = await fxFileGetById(portal, args)

  if (!existing) {
    return
  }

  const stmt = await portal.db.prepare(`
    DELETE FROM media_files
    WHERE id = ?
  `)
  await stmt.run(args.id)
}
