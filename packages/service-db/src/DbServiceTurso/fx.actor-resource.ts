import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import { fnResourceNameKey } from "../core/fn.resource-name"
import type {
  TActorDefinition,
  TActorResource,
  TActorResourceBinding,
  TActorResourceKind,
  TActorResourceStatus,
} from "../model"
import {
  fnParseActorDefinitionRow,
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
    SELECT id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
    FROM resource_catalog
    WHERE org_id = ? AND id = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.id)
  return row ? fnParseActorResourceRow(row) : null
}

export async function fxActorResourceList(portal: TPortal, args: TArgsList): Promise<TActorResource[]> {
  if (args.kind !== undefined && args.status !== undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      FROM resource_catalog
      WHERE org_id = ? AND kind = ? AND status = ?
      ORDER BY created_at_ms ASC, id ASC
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.kind, args.status)
    return rows.map(fnParseActorResourceRow)
  }
  if (args.kind !== undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      FROM resource_catalog
      WHERE org_id = ? AND kind = ?
      ORDER BY created_at_ms ASC, id ASC
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.kind)
    return rows.map(fnParseActorResourceRow)
  }
  if (args.status !== undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
      FROM resource_catalog
      WHERE org_id = ? AND status = ?
      ORDER BY created_at_ms ASC, id ASC
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.status)
    return rows.map(fnParseActorResourceRow)
  }
  const rows = await (await portal.db.prepare(`
    SELECT id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
    FROM resource_catalog
    WHERE org_id = ?
    ORDER BY created_at_ms ASC, id ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID)
  return rows.map(fnParseActorResourceRow)
}

export async function fxActorResourceFindByNameKey(
  portal: TPortal,
  args: TArgsFindByNameKey,
): Promise<TActorResource[]> {
  const rows = await (await portal.db.prepare(`
    SELECT id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
    FROM resource_catalog
    WHERE org_id = ?
    ORDER BY kind ASC, id ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID) as Array<{ name: string }>
  return rows
    .filter((row) => fnResourceNameKey(row.name) === args.nameKey)
    .map(fnParseActorResourceRow)
}

export async function fxActorResourceListBindingsForDefinition(
  portal: TPortal,
  args: TArgsListBindingsForDefinition,
): Promise<TActorResourceBinding[]> {
  const rows = await (await portal.db.prepare(`
    SELECT definition_name, slot_name, resource_id, allow_read, allow_write,
      created_at_ms, updated_at_ms
    FROM legacy_actor_resource_bindings
    WHERE org_id = ? AND definition_name = ?
    ORDER BY slot_name ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.definitionName)
  return rows.map(fnParseActorResourceBindingRow)
}

export async function fxActorResourceListBindingsForResource(
  portal: TPortal,
  args: TArgsListBindingsForResource,
): Promise<TActorResourceBinding[]> {
  const rows = await (await portal.db.prepare(`
    SELECT definition_name, slot_name, resource_id, allow_read, allow_write,
      created_at_ms, updated_at_ms
    FROM legacy_actor_resource_bindings
    WHERE org_id = ? AND resource_id = ?
    ORDER BY definition_name ASC, slot_name ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId)
  return rows.map(fnParseActorResourceBindingRow)
}

export async function fxActorResourceListDefinitionsReferencingResource(
  portal: TPortal,
  args: TArgsListBindingsForResource,
): Promise<TActorDefinition[]> {
  const rows = await (await portal.db.prepare(`
    SELECT DISTINCT definitions.name, definitions.slug, definitions.url,
      definitions.description, definitions.manifest_relative_path,
      definitions.created_at_ms, definitions.updated_at_ms
    FROM legacy_actor_definitions AS definitions
    INNER JOIN legacy_actor_resource_bindings AS bindings
      ON bindings.org_id = definitions.org_id
      AND bindings.definition_name = definitions.name
    WHERE definitions.org_id = ? AND bindings.resource_id = ?
    ORDER BY definitions.name ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId)
  return rows.map(fnParseActorDefinitionRow)
}
