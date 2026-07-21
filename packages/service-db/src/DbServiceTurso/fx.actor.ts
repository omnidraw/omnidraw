import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import type { TActorConnection, TActorDefinition, TActorInstance } from "../model"
import {
  fnParseActorConnectionRow,
  fnParseActorDefinitionRow,
  fnParseActorInstanceRow,
} from "./fn.actor-resource-row"

type TPortal = {
  db: Database
}

type TArgs = Record<never, never>

type TArgsListInstances = {
  canvasId?: string
}

type TArgsGetDefinition = {
  name: string
}

type TArgsGetInstanceByElementId = {
  elementId: string
}

type TArgsGetInstanceById = {
  instanceId: string
}

export async function fxActorListDefinitions(portal: TPortal, args: TArgs): Promise<TActorDefinition[]> {
  void args
  const rows = await (await portal.db.prepare(`
    SELECT name, slug, url, description, manifest_relative_path, created_at_ms, updated_at_ms
    FROM legacy_actor_definitions
    WHERE org_id = ?
    ORDER BY name ASC, slug ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID)
  return rows.map(fnParseActorDefinitionRow)
}

export async function fxActorGetDefinition(
  portal: TPortal,
  args: TArgsGetDefinition,
): Promise<TActorDefinition | null> {
  const row = await (await portal.db.prepare(`
    SELECT name, slug, url, description, manifest_relative_path, created_at_ms, updated_at_ms
    FROM legacy_actor_definitions
    WHERE org_id = ? AND name = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.name)
  return row ? fnParseActorDefinitionRow(row) : null
}

export async function fxActorListInstances(
  portal: TPortal,
  args: TArgsListInstances,
): Promise<TActorInstance[]> {
  if (args.canvasId === undefined) {
    const rows = await (await portal.db.prepare(`
      SELECT id, canvas_id, element_id, actor_definition_name, file_system_id,
        display_name, status, machine_state, machine_context_json, last_error_json,
        created_at_ms, updated_at_ms
      FROM legacy_actor_instances
      WHERE org_id = ?
      ORDER BY created_at_ms ASC, id ASC
    `)).all(DEFAULT_OSS_ORGANIZATION_ID)
    return rows.map(fnParseActorInstanceRow)
  }

  const rows = await (await portal.db.prepare(`
    SELECT id, canvas_id, element_id, actor_definition_name, file_system_id,
      display_name, status, machine_state, machine_context_json, last_error_json,
      created_at_ms, updated_at_ms
    FROM legacy_actor_instances
    WHERE org_id = ? AND canvas_id = ?
    ORDER BY created_at_ms ASC, id ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.canvasId)
  return rows.map(fnParseActorInstanceRow)
}

export async function fxActorListConnections(portal: TPortal, args: TArgs): Promise<TActorConnection[]> {
  void args
  const rows = await (await portal.db.prepare(`
    SELECT id, canvas_id, source_actor_instance_id, target_actor_instance_id,
      enabled, label, message_name_whitelist_json, style_json, created_at_ms
    FROM legacy_actor_connections
    WHERE org_id = ?
    ORDER BY created_at_ms ASC, id ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID)
  return rows.map(fnParseActorConnectionRow)
}

export async function fxActorGetInstanceByElementId(
  portal: TPortal,
  args: TArgsGetInstanceByElementId,
): Promise<TActorInstance | null> {
  const row = await (await portal.db.prepare(`
    SELECT id, canvas_id, element_id, actor_definition_name, file_system_id,
      display_name, status, machine_state, machine_context_json, last_error_json,
      created_at_ms, updated_at_ms
    FROM legacy_actor_instances
    WHERE org_id = ? AND element_id = ?
    ORDER BY created_at_ms ASC, id ASC
    LIMIT 1
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.elementId)
  return row ? fnParseActorInstanceRow(row) : null
}

export async function fxActorGetInstanceById(
  portal: TPortal,
  args: TArgsGetInstanceById,
): Promise<TActorInstance | null> {
  const row = await (await portal.db.prepare(`
    SELECT id, canvas_id, element_id, actor_definition_name, file_system_id,
      display_name, status, machine_state, machine_context_json, last_error_json,
      created_at_ms, updated_at_ms
    FROM legacy_actor_instances
    WHERE org_id = ? AND id = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.instanceId)
  return row ? fnParseActorInstanceRow(row) : null
}
