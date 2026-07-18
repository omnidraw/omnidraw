import type { Database } from "@tursodatabase/database"
import type {
  TActorDefinition,
  TActorResource,
  TActorResourceBinding,
  TActorResourceKind,
  TActorResourceStatus,
} from "../model"
import {
  fnParseActorResourceBindingRow,
  fnParseActorResourceRow,
} from "./fn.actor-resource-row"

type TPortal = {
  db: Database
}

type TArgsGet = {
  id: string
}

type TArgsList = {
  kind?: TActorResourceKind
  status?: TActorResourceStatus
}

type TArgsFindByNameKey = {
  nameKey: string
}

type TArgsListBindingsForDefinition = {
  definitionName: string
}

type TArgsListBindingsForResource = {
  resourceId: string
}

export async function fxActorResourceGet(portal: TPortal, args: TArgsGet): Promise<TActorResource | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resources
    WHERE id = ?
  `)).get(args.id)
  return row ? fnParseActorResourceRow(row) : null
}

export async function fxActorResourceList(portal: TPortal, args: TArgsList): Promise<TActorResource[]> {
  if (args.kind !== undefined && args.status !== undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resources
      WHERE kind = ? AND status = ?
      ORDER BY created_at ASC, id ASC
    `)).all(args.kind, args.status)
    return rows.map(fnParseActorResourceRow)
  }
  if (args.kind !== undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resources
      WHERE kind = ?
      ORDER BY created_at ASC, id ASC
    `)).all(args.kind)
    return rows.map(fnParseActorResourceRow)
  }
  if (args.status !== undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resources
      WHERE status = ?
      ORDER BY created_at ASC, id ASC
    `)).all(args.status)
    return rows.map(fnParseActorResourceRow)
  }
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resources
    ORDER BY created_at ASC, id ASC
  `)).all()
  return rows.map(fnParseActorResourceRow)
}

export async function fxActorResourceFindByNameKey(
  portal: TPortal,
  args: TArgsFindByNameKey,
): Promise<TActorResource[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resources
    WHERE name_key = ?
    ORDER BY kind ASC, id ASC
  `)).all(args.nameKey)
  return rows.map(fnParseActorResourceRow)
}

export async function fxActorResourceListBindingsForDefinition(
  portal: TPortal,
  args: TArgsListBindingsForDefinition,
): Promise<TActorResourceBinding[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resource_bindings
    WHERE actor_definition_name = ?
    ORDER BY slot_name ASC
  `)).all(args.definitionName)
  return rows.map(fnParseActorResourceBindingRow)
}

export async function fxActorResourceListBindingsForResource(
  portal: TPortal,
  args: TArgsListBindingsForResource,
): Promise<TActorResourceBinding[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resource_bindings
    WHERE resource_id = ?
    ORDER BY actor_definition_name ASC, slot_name ASC
  `)).all(args.resourceId)
  return rows.map(fnParseActorResourceBindingRow)
}

export async function fxActorResourceListDefinitionsReferencingResource(
  portal: TPortal,
  args: TArgsListBindingsForResource,
): Promise<TActorDefinition[]> {
  const rows = await (await portal.db.prepare(`
    SELECT DISTINCT actor_definitions.*
    FROM actor_definitions
    INNER JOIN actor_resource_bindings
      ON actor_resource_bindings.actor_definition_name = actor_definitions.name
    WHERE actor_resource_bindings.resource_id = ?
    ORDER BY actor_definitions.name ASC
  `)).all(args.resourceId)
  return rows as TActorDefinition[]
}
