import type { Database } from "@tursodatabase/database"
import type { TActorConnection, TActorDefinition, TActorInstance } from "../model"

type TPortal = {
  db: Database
}

type TArgsListInstances = {
  canvasId?: string
}

export async function fxActorListDefinitions(portal: TPortal): Promise<TActorDefinition[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_definitions
    ORDER BY name ASC, slug ASC, id ASC
  `)
  const rows = await stmt.all()
  return rows as TActorDefinition[]
}

export async function fxActorListInstances(portal: TPortal, args: TArgsListInstances): Promise<TActorInstance[]> {
  if (!args.canvasId) {
    const stmt = await portal.db.prepare(`
      SELECT *
      FROM actor_instances
      ORDER BY created_at ASC, id ASC
    `)
    const rows = await stmt.all()
    return rows as TActorInstance[]
  }

  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_instances
    WHERE canvas_id = ?
    ORDER BY created_at ASC, id ASC
  `)
  const rows = await stmt.all(args.canvasId)
  return rows as TActorInstance[]
}

export async function fxActorListConnections(portal: TPortal): Promise<TActorConnection[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_connections
    ORDER BY created_at ASC, id ASC
  `)
  const rows = await stmt.all()
  return rows as TActorConnection[]
}
