import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import type { TMediaFile } from "../model"
import { fnTimestampFromMs } from "./fn.legacy-row"

type TPortal = {
  db: Database
}

type TArgs = {}

type TArgsGetById = {
  id: string
}

function parseMediaFileRow(row: unknown): TMediaFile {
  const value = row as {
    id: string
    source_hash: string
    mime_type: TMediaFile["mime_type"]
    data: TMediaFile["data"]
    created_at_ms: unknown
  }
  return {
    id: value.id,
    hash: value.source_hash,
    mime_type: value.mime_type,
    data: value.data,
    created_at: fnTimestampFromMs(value.created_at_ms),
  }
}

export async function fxFileListAll(portal: TPortal, args: TArgs): Promise<TMediaFile[]> {
  const stmt = await portal.db.prepare(`
    SELECT id, source_hash, mime_type, data, created_at_ms
    FROM media_files
    WHERE org_id = ?
    ORDER BY created_at_ms ASC, id ASC
  `)
  const rows = await stmt.all(DEFAULT_OSS_ORGANIZATION_ID)
  return rows.map(parseMediaFileRow)
}

export async function fxFileGetById(portal: TPortal, args: TArgsGetById): Promise<TMediaFile | null> {
  const stmt = await portal.db.prepare(`
    SELECT id, source_hash, mime_type, data, created_at_ms
    FROM media_files
    WHERE org_id = ? AND id = ?
  `)
  const row = await stmt.get(DEFAULT_OSS_ORGANIZATION_ID, args.id)
  return row ? parseMediaFileRow(row) : null
}
