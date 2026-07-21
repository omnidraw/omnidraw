import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
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
    INSERT INTO media_files (
      org_id, id, canvas_id, source_hash, digest_sha256, mime_type, byte_size, data, created_at_ms
    )
    VALUES (?, ?, NULL, ?, NULL, ?, length(?), ?, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  `)
  await stmt.run(
    DEFAULT_OSS_ORGANIZATION_ID,
    args.id,
    args.hash,
    args.mime_type,
    args.data,
    args.data,
  )
  const created = await fxFileGetById(portal, { id: args.id })
  if (!created) throw new Error("Failed to create media file record")
  return created
}

export async function txFileDeleteById(portal: TPortal, args: TArgsDeleteById): Promise<void> {
  const existing = await fxFileGetById(portal, args)

  if (!existing) {
    return
  }

  const stmt = await portal.db.prepare(`
    DELETE FROM media_files
    WHERE org_id = ? AND id = ?
  `)
  await stmt.run(DEFAULT_OSS_ORGANIZATION_ID, args.id)
}
