import type { Database } from "@tursodatabase/database"
import type { TActorConnection, TActorDefinition, TActorInstance } from "../model"

type TPortal = {
  db: Database
}

type TArgsDefinitionCreate = Omit<TActorDefinition, "created_at" | "updated_at">
type TArgsDefinitionDelete = { name: string }
type TArgsDefinitionUpdate = Omit<TActorDefinition, "created_at" | "updated_at">
type TArgsInstanceCreate = Omit<TActorInstance, "created_at" | "updated_at">
type TArgsInstanceUpdateStatus = Pick<TActorInstance, "id" | "status">
type TArgsInstanceUpdateMachine = Pick<TActorInstance, "id" | "machine_context" | "machine_state">
type TArgsInstanceDelete = { id: string }
type TArgsConnectionCreate = Omit<TActorConnection, "created_at" | "updated_at">
type TArgsConnectionDeleteById = { id: string }
type TArgsConnectionDeleteBySource = { actorId: string }

export async function txActorInsertDefinition(portal: TPortal, args: TArgsDefinitionCreate): Promise<TActorDefinition> {
  const stmt = await portal.db.prepare(`
    INSERT INTO actor_definitions (name, slug, url, description, manifest_path)
    VALUES (?, ?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.name, args.slug, args.url, args.description, args.manifest_path)
  if (!row) throw new Error("Failed to insert actor definition")
  return row as TActorDefinition
}

export async function txActorDeleteDefinition(portal: TPortal, args: TArgsDefinitionDelete): Promise<void> {
  const stmt = await portal.db.prepare(`
    DELETE FROM actor_definitions
    WHERE name = ?
  `)
  await stmt.run(args.name)
}

export async function txActorUpdateDefinition(portal: TPortal, args: TArgsDefinitionUpdate): Promise<TActorDefinition> {
  const stmt = await portal.db.prepare(`
    UPDATE actor_definitions
    SET name = ?, url = ?, description = ?, manifest_path = ?
    WHERE slug = ?
    RETURNING *
  `)
  const row = await stmt.get(args.name, args.url, args.description, args.manifest_path, args.slug)
  if (!row) throw new Error(`Unknown actor definition slug "${args.slug}"`)
  return row as TActorDefinition
}

export async function txActorInsertInstance(portal: TPortal, args: TArgsInstanceCreate): Promise<TActorInstance> {
  const stmt = await portal.db.prepare(`
    INSERT INTO actor_instances (id, canvas_id, element_id, actor_definition_id, filesystem_id, display_name, status, machine_state, machine_context)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.id, args.canvas_id, args.element_id, args.actor_definition_id, args.filesystem_id, args.display_name, args.status, args.machine_state, args.machine_context)
  if (!row) throw new Error("Failed to insert actor instance")
  return row as TActorInstance
}

export async function txActorUpdateInstanceStatus(portal: TPortal, args: TArgsInstanceUpdateStatus): Promise<TActorInstance> {
  const stmt = await portal.db.prepare(`
    UPDATE actor_instances
    SET status = ?
    WHERE id = ?
    RETURNING *
  `)
  const row = await stmt.get(args.status, args.id)
  if (!row) throw new Error(`Unknown actor instance "${args.id}"`)
  return row as TActorInstance
}

export async function txActorUpdateInstanceMachine(portal: TPortal, args: TArgsInstanceUpdateMachine): Promise<TActorInstance> {
  const stmt = await portal.db.prepare(`
    UPDATE actor_instances
    SET machine_state = ?, machine_context = ?
    WHERE id = ?
    RETURNING *
  `)
  const row = await stmt.get(args.machine_state, args.machine_context, args.id)
  if (!row) throw new Error(`Unknown actor instance "${args.id}"`)
  return row as TActorInstance
}

export async function txActorDeleteInstance(portal: TPortal, args: TArgsInstanceDelete): Promise<void> {
  const stmt = await portal.db.prepare(`
    DELETE FROM actor_instances
    WHERE id = ?
  `)
  await stmt.run(args.id)
}

export async function txActorInsertConnection(portal: TPortal, args: TArgsConnectionCreate): Promise<TActorConnection> {
  const stmt = await portal.db.prepare(`
    INSERT INTO actor_connections (id, canvas_id, source_actor_instance_id, target_actor_instance_id, enabled, label, msg_name_whitelist, style)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `)
  const row = await stmt.get(args.id, args.canvas_id, args.source_actor_instance_id, args.target_actor_instance_id, args.enabled, args.label, args.msg_name_whitelist, args.style)
  if (!row) throw new Error("Failed to insert actor connection")
  return row as TActorConnection
}

export async function txActorDeleteConnectionById(portal: TPortal, args: TArgsConnectionDeleteById): Promise<void> {
  const stmt = await portal.db.prepare(`
    DELETE FROM actor_connections
    WHERE id = ?
  `)
  await stmt.run(args.id)
}

export async function txActorDeleteConnectionBySource(portal: TPortal, args: TArgsConnectionDeleteBySource): Promise<void> {
  const stmt = await portal.db.prepare(`
    DELETE FROM actor_connections
    WHERE source_actor_instance_id = ?
  `)
  await stmt.run(args.actorId)
}
