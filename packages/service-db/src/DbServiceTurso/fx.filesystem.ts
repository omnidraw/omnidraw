import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import type { TFilesystem } from "../model"
import { fnTimestampFromMs } from "./fn.legacy-row"

type TPortal = {
  db: Database
}

type TArgs = {}

type TArgsFindById = {
  id: string
}

function parseFilesystemRow(row: unknown): TFilesystem {
  const value = row as {
    id: string
    name: string
    slug: string
    capability_ref: string
    description: string | null
    created_at_ms: unknown
    updated_at_ms: unknown
  }
  return {
    id: value.id,
    name: value.name,
    slug: value.slug,
    path: value.capability_ref === `legacy-empty:${value.id}` ? "" : value.capability_ref,
    description: value.description,
    created_at: fnTimestampFromMs(value.created_at_ms),
    updated_at: fnTimestampFromMs(value.updated_at_ms),
  }
}

export async function fxFilesystemListAll(portal: TPortal, args: TArgs): Promise<TFilesystem[]> {
  const stmt = await portal.db.prepare(`
    SELECT id, name, slug, capability_ref, description, created_at_ms, updated_at_ms
    FROM file_systems
    WHERE org_id = ?
    ORDER BY created_at_ms ASC, id ASC
  `)
  const rows = await stmt.all(DEFAULT_OSS_ORGANIZATION_ID)
  return rows.map(parseFilesystemRow)
}

export async function fxFilesystemFindById(portal: TPortal, args: TArgsFindById): Promise<TFilesystem | null> {
  const stmt = await portal.db.prepare(`
    SELECT id, name, slug, capability_ref, description, created_at_ms, updated_at_ms
    FROM file_systems
    WHERE org_id = ? AND id = ?
  `)
  const row = await stmt.get(DEFAULT_OSS_ORGANIZATION_ID, args.id)
  return row ? parseFilesystemRow(row) : null
}
