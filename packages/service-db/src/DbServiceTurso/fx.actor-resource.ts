import type { Database } from "@tursodatabase/database"
import type {
  TActorDefinition,
  TActorResource,
  TActorResourceBinding,
  TActorResourceKeyValue,
  TActorResourceKind,
  TActorResourceStatus,
} from "../model"
import {
  fnActorResourceKeyValueListLimit,
  fnParseActorResourceBindingRow,
  fnParseActorResourceKeyValueRow,
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

type TArgsListBindingsForDefinition = {
  definitionName: string
}

type TArgsListBindingsForResource = {
  resourceId: string
}

type TArgsKeyValueGet = {
  resourceId: string
  key: string
}

type TArgsKeyValueList = {
  resourceId: string
  prefix?: string
  cursor?: string
  limit?: number
}

export type TActorResourceKeyValuePage = {
  entries: TActorResourceKeyValue[]
  nextCursor: string | null
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

export async function fxActorResourceKeyValueGet(
  portal: TPortal,
  args: TArgsKeyValueGet,
): Promise<TActorResourceKeyValue | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resource_key_values
    WHERE resource_id = ? AND key = ?
  `)).get(args.resourceId, args.key)
  return row ? fnParseActorResourceKeyValueRow(row) : null
}

export async function fxActorResourceKeyValueHas(portal: TPortal, args: TArgsKeyValueGet): Promise<boolean> {
  const row = await (await portal.db.prepare(`
    SELECT 1 AS present
    FROM actor_resource_key_values
    WHERE resource_id = ? AND key = ?
  `)).get(args.resourceId, args.key) as { present: number } | null | undefined
  return row !== null && row !== undefined
}

export async function fxActorResourceKeyValueList(
  portal: TPortal,
  args: TArgsKeyValueList,
): Promise<TActorResourceKeyValuePage> {
  const limit = fnActorResourceKeyValueListLimit(args.limit)
  const queryLimit = limit + 1
  let rows: unknown[]

  if (args.prefix !== undefined && args.cursor !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resource_key_values
      WHERE resource_id = ?
        AND substr(key, 1, length(?)) = ?
        AND key > ?
      ORDER BY key ASC
      LIMIT ?
    `)).all(args.resourceId, args.prefix, args.prefix, args.cursor, queryLimit)
  } else if (args.prefix !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resource_key_values
      WHERE resource_id = ?
        AND substr(key, 1, length(?)) = ?
      ORDER BY key ASC
      LIMIT ?
    `)).all(args.resourceId, args.prefix, args.prefix, queryLimit)
  } else if (args.cursor !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resource_key_values
      WHERE resource_id = ? AND key > ?
      ORDER BY key ASC
      LIMIT ?
    `)).all(args.resourceId, args.cursor, queryLimit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM actor_resource_key_values
      WHERE resource_id = ?
      ORDER BY key ASC
      LIMIT ?
    `)).all(args.resourceId, queryLimit)
  }

  const parsed = rows.map(fnParseActorResourceKeyValueRow)
  const entries = parsed.slice(0, limit)
  return {
    entries,
    nextCursor: parsed.length > limit ? entries.at(-1)?.key ?? null : null,
  }
}
