import type { Database } from "@tursodatabase/database"
import type { TActorConnection, TActorDefinition, TActorInstance, TJson } from "../model"

type TPortal = {
  db: Database
}

type TArgsListInstances = {
  canvasId?: string
}

type TArgsGetDefinition = {
  name: string
}

function parseJson(value: unknown): TJson {
  if (typeof value !== "string") return value as TJson

  return JSON.parse(value) as TJson
}

function parseActorInstance(row: unknown): TActorInstance {
  const instance = row as TActorInstance
  return {
    ...instance,
    machine_context: parseJson(instance.machine_context),
  }
}

function parseActorConnection(row: unknown): TActorConnection {
  const connection = row as TActorConnection
  return {
    ...connection,
    style: parseJson(connection.style),
  }
}

export async function fxActorListDefinitions(portal: TPortal): Promise<TActorDefinition[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_definitions
    ORDER BY name ASC, slug ASC
  `)
  const rows = await stmt.all()
  return rows as TActorDefinition[]
}

export async function fxActorGetDefinition(portal: TPortal, args: TArgsGetDefinition): Promise<TActorDefinition | null> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_definitions
    WHERE name = ?
  `)
  const rows = await stmt.get(args.name)
  return rows as TActorDefinition
}

export async function fxActorListInstances(portal: TPortal, args: TArgsListInstances): Promise<TActorInstance[]> {
  if (!args.canvasId) {
    const stmt = await portal.db.prepare(`
      SELECT *
      FROM actor_instances
      ORDER BY created_at ASC, id ASC
    `)
    const rows = await stmt.all()
    return rows.map(parseActorInstance)
  }

  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_instances
    WHERE canvas_id = ?
    ORDER BY created_at ASC, id ASC
  `)
  const rows = await stmt.all(args.canvasId)
  return rows.map(parseActorInstance)
}

export async function fxActorListConnections(portal: TPortal): Promise<TActorConnection[]> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_connections
    ORDER BY created_at ASC, id ASC
  `)
  const rows = await stmt.all()
  return rows.map(parseActorConnection)
}

type TArgsGetInstanceByElementId = {
  elementId: string
}
export async function fxActorGetInstanceByElementId(portal: TPortal, args: TArgsGetInstanceByElementId): Promise<TActorInstance | null> {
  const stmt = await portal.db.prepare(`
    SELECT *
    FROM actor_instances
    WHERE element_id = ?
  `)
  return await stmt.get(args.elementId)
}
