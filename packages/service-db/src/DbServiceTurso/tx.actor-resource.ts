import type { Database } from "@tursodatabase/database"
import type {
  TActorResource,
  TActorResourceBinding,
  TActorResourceKeyValue,
  TActorResourceKind,
  TActorResourceStatus,
  TJson,
} from "../model"
import {
  fnParseActorResourceBindingRow,
  fnParseActorResourceRow,
  fnSerializeJsonValue,
} from "./fn.actor-resource-row"
import { fxActorResourceGet, fxActorResourceKeyValueGet } from "./fx.actor-resource"

type TPortal = {
  db: Database
}

type TArgsCreate = {
  id: string
  kind: TActorResourceKind
  name: string
  status?: TActorResourceStatus
  lastError?: TJson | null
}

type TArgsRename = {
  id: string
  name: string
}

type TArgsUpdateProviderState = {
  id: string
  status?: TActorResourceStatus
  lastError?: TJson | null
}

type TArgsResourceId = {
  id: string
}

type TArgsUpsertBinding = {
  definitionName: string
  slotName: string
  resourceId: string
  allowRead: boolean
  allowWrite: boolean
}

type TArgsRemoveBinding = {
  definitionName: string
  slotName: string
}

type TArgsKeyValueSet = {
  resourceId: string
  key: string
  value: TJson
}

type TArgsKeyValueDelete = {
  resourceId: string
  key: string
}

type TArgsKeyValueCompareAndSet = TArgsKeyValueSet & {
  expectedRevision: number | null
}

export type TActorResourceKeyValueDeleteResult = {
  deleted: boolean
}

export type TActorResourceKeyValueCompareAndSetResult =
  | { ok: true; entry: TActorResourceKeyValue }
  | { ok: false; expectedRevision: number | null; currentRevision: number | null }

export async function txActorResourceCreate(portal: TPortal, args: TArgsCreate): Promise<TActorResource> {
  const insert = await portal.db.prepare(`
    INSERT INTO actor_resources (id, kind, name, status, last_error)
    VALUES (?, ?, ?, ?, ?)
  `)
  await insert.run(
    args.id,
    args.kind,
    args.name,
    args.status ?? "created",
    args.lastError === undefined || args.lastError === null ? null : fnSerializeJsonValue(args.lastError),
  )
  const created = await fxActorResourceGet(portal, { id: args.id })
  if (!created) throw new Error(`Failed to create actor resource "${args.id}"`)
  return created
}

export async function txActorResourceRename(portal: TPortal, args: TArgsRename): Promise<TActorResource | null> {
  await (await portal.db.prepare(`
    UPDATE actor_resources
    SET name = ?
    WHERE id = ?
  `)).run(args.name, args.id)
  return fxActorResourceGet(portal, { id: args.id })
}

export async function txActorResourceUpdateProviderState(
  portal: TPortal,
  args: TArgsUpdateProviderState,
): Promise<TActorResource | null> {
  const hasStatus = args.status !== undefined
  const hasLastError = args.lastError !== undefined
  await (await portal.db.prepare(`
    UPDATE actor_resources
    SET status = CASE WHEN ? THEN ? ELSE status END,
        last_error = CASE WHEN ? THEN ? ELSE last_error END
    WHERE id = ?
  `)).run(
    hasStatus,
    args.status ?? null,
    hasLastError,
    args.lastError === undefined || args.lastError === null ? null : fnSerializeJsonValue(args.lastError),
    args.id,
  )
  return fxActorResourceGet(portal, { id: args.id })
}

export async function txActorResourceBeginDelete(portal: TPortal, args: TArgsResourceId): Promise<TActorResource | null> {
  const result = await (await portal.db.prepare(`
    UPDATE actor_resources
    SET status = 'deleting'
    WHERE id = ?
      AND status IN ('created', 'ready', 'error', 'deleting')
      AND NOT EXISTS (
        SELECT 1
        FROM actor_resource_bindings
        WHERE resource_id = actor_resources.id
      )
  `)).run(args.id)
  if (result.changes === 0) return null
  return fxActorResourceGet(portal, { id: args.id })
}

export async function txActorResourceDelete(portal: TPortal, args: TArgsResourceId): Promise<boolean> {
  const result = await (await portal.db.prepare(`
    DELETE FROM actor_resources
    WHERE id = ?
      AND status = 'deleting'
      AND NOT EXISTS (
        SELECT 1
        FROM actor_resource_bindings
        WHERE resource_id = actor_resources.id
      )
  `)).run(args.id)
  return result.changes > 0
}

export async function txActorResourceUpsertBinding(
  portal: TPortal,
  args: TArgsUpsertBinding,
): Promise<TActorResourceBinding | null> {
  const result = await (await portal.db.prepare(`
    INSERT INTO actor_resource_bindings (
      actor_definition_name,
      slot_name,
      resource_id,
      allow_read,
      allow_write
    )
    SELECT ?, ?, id, ?, ?
    FROM actor_resources
    WHERE id = ? AND status = 'ready'
    ON CONFLICT (actor_definition_name, slot_name) DO UPDATE SET
      resource_id = excluded.resource_id,
      allow_read = excluded.allow_read,
      allow_write = excluded.allow_write
  `)).run(
    args.definitionName,
    args.slotName,
    args.allowRead,
    args.allowWrite,
    args.resourceId,
  )
  if (result.changes === 0) return null
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM actor_resource_bindings
    WHERE actor_definition_name = ? AND slot_name = ?
  `)).get(args.definitionName, args.slotName)
  return row ? fnParseActorResourceBindingRow(row) : null
}

export async function txActorResourceRemoveBinding(portal: TPortal, args: TArgsRemoveBinding): Promise<boolean> {
  const result = await (await portal.db.prepare(`
    DELETE FROM actor_resource_bindings
    WHERE actor_definition_name = ? AND slot_name = ?
  `)).run(args.definitionName, args.slotName)
  return result.changes > 0
}

export async function txActorResourceKeyValueSet(
  portal: TPortal,
  args: TArgsKeyValueSet,
): Promise<TActorResourceKeyValue> {
  await (await portal.db.prepare(`
    INSERT INTO actor_resource_key_values (resource_id, key, value)
    VALUES (?, ?, ?)
    ON CONFLICT (resource_id, key) DO UPDATE SET
      value = excluded.value,
      revision = actor_resource_key_values.revision + 1
  `)).run(args.resourceId, args.key, fnSerializeJsonValue(args.value))
  const entry = await fxActorResourceKeyValueGet(portal, args)
  if (!entry) throw new Error("Failed to set actor resource key-value entry")
  return entry
}

export async function txActorResourceKeyValueDelete(
  portal: TPortal,
  args: TArgsKeyValueDelete,
): Promise<TActorResourceKeyValueDeleteResult> {
  const result = await (await portal.db.prepare(`
    DELETE FROM actor_resource_key_values
    WHERE resource_id = ? AND key = ?
  `)).run(args.resourceId, args.key)
  return { deleted: result.changes > 0 }
}

export async function txActorResourceKeyValueCompareAndSet(
  portal: TPortal,
  args: TArgsKeyValueCompareAndSet,
): Promise<TActorResourceKeyValueCompareAndSetResult> {
  if (args.expectedRevision !== null && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1)) {
    throw new RangeError("Expected revision must be null or a positive integer")
  }

  const serialized = fnSerializeJsonValue(args.value)
  const result = args.expectedRevision === null
    ? await (await portal.db.prepare(`
        INSERT INTO actor_resource_key_values (resource_id, key, value)
        VALUES (?, ?, ?)
        ON CONFLICT (resource_id, key) DO NOTHING
      `)).run(args.resourceId, args.key, serialized)
    : await (await portal.db.prepare(`
        UPDATE actor_resource_key_values
        SET value = ?, revision = revision + 1
        WHERE resource_id = ? AND key = ? AND revision = ?
      `)).run(serialized, args.resourceId, args.key, args.expectedRevision)

  const current = await fxActorResourceKeyValueGet(portal, args)
  if (result.changes === 0) {
    return {
      ok: false,
      expectedRevision: args.expectedRevision,
      currentRevision: current?.revision ?? null,
    }
  }
  if (!current) throw new Error("Actor resource key-value CAS succeeded without a persisted entry")
  return { ok: true, entry: current }
}
