import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import type { TActorConnection, TActorDefinition, TActorInstance, TJson } from "../model"
import {
  fnParseActorConnectionRow,
  fnParseActorDefinitionRow,
  fnSerializeJsonValue,
} from "./fn.actor-resource-row"
import { fxActorGetInstanceById } from "./fx.actor"

type TPortal = {
  db: Database
}

type TArgsDefinitionCreate = Omit<TActorDefinition, "created_at" | "updated_at">
type TArgsDefinitionDelete = { name: string }
type TArgsDefinitionUpdate = Omit<TActorDefinition, "created_at" | "updated_at"> & { currentSlug?: string }
type TArgsInstanceCreate = Omit<TActorInstance, "created_at" | "updated_at" | "machine_context" | "last_error"> & {
  machine_context: TJson
  last_error?: TActorInstance["last_error"]
}
type TArgsInstanceUpdateStatus = Pick<TActorInstance, "id" | "status">
type TArgsInstanceUpdateHealth = Pick<TActorInstance, "id" | "status" | "last_error">
type TArgsInstanceUpdateMachine = Pick<TActorInstance, "id" | "machine_state"> & { machine_context: TJson }
type TArgsInstanceDelete = { id: string }
type TArgsConnectionCreate = Omit<TActorConnection, "created_at" | "style"> & { style: TJson }
type TArgsConnectionDeleteById = { id: string }
type TArgsConnectionDeleteBySource = { actorId: string }

export async function txActorInsertDefinition(
  portal: TPortal,
  args: TArgsDefinitionCreate,
): Promise<TActorDefinition> {
  await (await portal.db.prepare(`
    INSERT INTO legacy_actor_definitions (
      org_id, name, slug, url, description, manifest_relative_path, created_at_ms, updated_at_ms
    )
    VALUES (
      ?, ?, ?, ?, ?, ?,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    args.name,
    args.slug,
    args.url,
    args.description,
    args.manifest_path,
  )
  const row = await (await portal.db.prepare(`
    SELECT name, slug, url, description, manifest_relative_path, created_at_ms, updated_at_ms
    FROM legacy_actor_definitions
    WHERE org_id = ? AND name = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.name)
  if (!row) throw new Error("Failed to insert actor definition")
  return fnParseActorDefinitionRow(row)
}

export async function txActorDeleteDefinition(portal: TPortal, args: TArgsDefinitionDelete): Promise<void> {
  await (await portal.db.prepare(`
    DELETE FROM legacy_actor_definitions
    WHERE org_id = ? AND name = ?
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, args.name)
}

export async function txActorUpdateDefinition(
  portal: TPortal,
  args: TArgsDefinitionUpdate,
): Promise<TActorDefinition> {
  await (await portal.db.prepare(`
    UPDATE legacy_actor_definitions
    SET name = ?, slug = ?, url = ?, description = ?, manifest_relative_path = ?,
      updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND slug = ?
  `)).run(
    args.name,
    args.slug,
    args.url,
    args.description,
    args.manifest_path,
    DEFAULT_OSS_ORGANIZATION_ID,
    args.currentSlug ?? args.slug,
  )
  const row = await (await portal.db.prepare(`
    SELECT name, slug, url, description, manifest_relative_path, created_at_ms, updated_at_ms
    FROM legacy_actor_definitions
    WHERE org_id = ? AND slug = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.slug)
  if (!row) throw new Error(`Unknown actor definition slug "${args.slug}"`)
  return fnParseActorDefinitionRow(row)
}

export async function txActorInsertInstance(portal: TPortal, args: TArgsInstanceCreate): Promise<TActorInstance> {
  await (await portal.db.prepare(`
    INSERT INTO legacy_actor_instances (
      org_id, id, canvas_id, element_id, actor_definition_name, file_system_id,
      display_name, status, machine_state, machine_context_json, last_error_json,
      created_at_ms, updated_at_ms
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    args.id,
    args.canvas_id,
    args.element_id,
    args.actor_definition_name,
    args.filesystem_id,
    args.display_name,
    args.status,
    args.machine_state,
    fnSerializeJsonValue(args.machine_context),
    args.last_error == null ? null : fnSerializeJsonValue(args.last_error),
  )
  const created = await fxActorGetInstanceById(portal, { instanceId: args.id })
  if (!created) throw new Error("Failed to insert actor instance")
  return created
}

export async function txActorUpdateInstanceHealth(
  portal: TPortal,
  args: TArgsInstanceUpdateHealth,
): Promise<TActorInstance> {
  await (await portal.db.prepare(`
    UPDATE legacy_actor_instances
    SET status = ?, last_error_json = ?,
      updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)).run(
    args.status,
    args.last_error === null ? null : fnSerializeJsonValue(args.last_error),
    DEFAULT_OSS_ORGANIZATION_ID,
    args.id,
  )
  const updated = await fxActorGetInstanceById(portal, { instanceId: args.id })
  if (!updated) throw new Error(`Unknown actor instance "${args.id}"`)
  return updated
}

export async function txActorUpdateInstanceStatus(
  portal: TPortal,
  args: TArgsInstanceUpdateStatus,
): Promise<TActorInstance> {
  await (await portal.db.prepare(`
    UPDATE legacy_actor_instances
    SET status = ?, updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)).run(args.status, DEFAULT_OSS_ORGANIZATION_ID, args.id)
  const updated = await fxActorGetInstanceById(portal, { instanceId: args.id })
  if (!updated) throw new Error(`Unknown actor instance "${args.id}"`)
  return updated
}

export async function txActorUpdateInstanceMachine(
  portal: TPortal,
  args: TArgsInstanceUpdateMachine,
): Promise<TActorInstance> {
  await (await portal.db.prepare(`
    UPDATE legacy_actor_instances
    SET machine_state = ?, machine_context_json = ?,
      updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)).run(
    args.machine_state,
    fnSerializeJsonValue(args.machine_context),
    DEFAULT_OSS_ORGANIZATION_ID,
    args.id,
  )
  const updated = await fxActorGetInstanceById(portal, { instanceId: args.id })
  if (!updated) throw new Error(`Unknown actor instance "${args.id}"`)
  return updated
}

export async function txActorDeleteInstance(portal: TPortal, args: TArgsInstanceDelete): Promise<void> {
  await (await portal.db.prepare(`
    DELETE FROM legacy_actor_instances
    WHERE org_id = ? AND id = ?
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, args.id)
}

export async function txActorInsertConnection(
  portal: TPortal,
  args: TArgsConnectionCreate,
): Promise<TActorConnection> {
  await (await portal.db.prepare(`
    INSERT INTO legacy_actor_connections (
      org_id, id, canvas_id, source_actor_instance_id, target_actor_instance_id,
      enabled, label, message_name_whitelist_json, style_json, created_at_ms
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  `)).run(
    DEFAULT_OSS_ORGANIZATION_ID,
    args.id,
    args.canvas_id,
    args.source_actor_instance_id,
    args.target_actor_instance_id,
    args.enabled ? 1 : 0,
    args.label,
    args.msg_name_whitelist,
    fnSerializeJsonValue(args.style),
  )
  const row = await (await portal.db.prepare(`
    SELECT id, canvas_id, source_actor_instance_id, target_actor_instance_id,
      enabled, label, message_name_whitelist_json, style_json, created_at_ms
    FROM legacy_actor_connections
    WHERE org_id = ? AND id = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.id)
  if (!row) throw new Error("Failed to insert actor connection")
  return fnParseActorConnectionRow(row)
}

export async function txActorDeleteConnectionById(
  portal: TPortal,
  args: TArgsConnectionDeleteById,
): Promise<void> {
  await (await portal.db.prepare(`
    DELETE FROM legacy_actor_connections
    WHERE org_id = ? AND id = ?
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, args.id)
}

export async function txActorDeleteConnectionBySource(
  portal: TPortal,
  args: TArgsConnectionDeleteBySource,
): Promise<void> {
  await (await portal.db.prepare(`
    DELETE FROM legacy_actor_connections
    WHERE org_id = ? AND source_actor_instance_id = ?
  `)).run(DEFAULT_OSS_ORGANIZATION_ID, args.actorId)
}
