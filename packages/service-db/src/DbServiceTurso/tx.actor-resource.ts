import type { Database } from "@tursodatabase/database"
import type {
  TActorResource,
  TActorResourceBinding,
  TActorResourceKeyValue,
  TActorResourceKind,
  TActorResourceStatus,
  TJson,
} from "../model"
import { fnNormalizeResourceName, fnResourceNameKey } from "../core/fn.resource-name"
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

type TArgsAuditNames = Record<never, never>

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
  expectedRevision?: number
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

function resourceNameConflictError(name: string): Error & { code: string } {
  return Object.assign(new Error(`Resource name '${name}' is already in use.`), { code: "RESOURCE_NAME_CONFLICT" })
}

function rethrowResourceNameMutationError(error: unknown, name: string): never {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("RESOURCE_NAME_CONFLICT")) {
    throw resourceNameConflictError(name)
  }
  throw error
}

export async function txActorResourceCreate(portal: TPortal, args: TArgsCreate): Promise<TActorResource> {
  const normalized = fnNormalizeResourceName(args.name)
  if (!normalized.ok) throw Object.assign(new Error(normalized.message), { code: normalized.code })
  const insert = await portal.db.prepare(`
    INSERT INTO actor_resources (id, kind, name, name_key, status, last_error)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM actor_resources WHERE name_key = ?
    )
  `)
  const result = await insert.run(
    args.id,
    args.kind,
    normalized.value.name,
    normalized.value.key,
    args.status ?? "created",
    args.lastError === undefined || args.lastError === null ? null : fnSerializeJsonValue(args.lastError),
    normalized.value.key,
  ).catch((error) => rethrowResourceNameMutationError(error, normalized.value.name))
  if (result.changes === 0) {
    throw resourceNameConflictError(normalized.value.name)
  }
  const created = await fxActorResourceGet(portal, { id: args.id })
  if (!created) throw new Error("Failed to create actor resource")
  return created
}

export async function txActorResourceRename(portal: TPortal, args: TArgsRename): Promise<TActorResource | null> {
  const normalized = fnNormalizeResourceName(args.name)
  if (!normalized.ok) throw Object.assign(new Error(normalized.message), { code: normalized.code })
  const result = await (await portal.db.prepare(`
    UPDATE actor_resources
    SET name = ?, name_key = ?
    WHERE id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM actor_resources AS collision
        WHERE collision.name_key = ? AND collision.id <> ?
      )
  `)).run(normalized.value.name, normalized.value.key, args.id, normalized.value.key, args.id)
    .catch((error) => rethrowResourceNameMutationError(error, normalized.value.name))
  if (result.changes === 0) {
    const current = await fxActorResourceGet(portal, { id: args.id })
    if (!current) return null
    throw resourceNameConflictError(normalized.value.name)
  }
  return fxActorResourceGet(portal, { id: args.id })
}

export async function txActorResourceAuditNames(portal: TPortal, args: TArgsAuditNames): Promise<void> {
  void args
  const rows = await (await portal.db.prepare(`
    SELECT id, name
    FROM actor_resources
    ORDER BY id ASC
  `)).all() as { id: string; name: string }[]
  const update = await portal.db.prepare(`
    UPDATE actor_resources
    SET name_key = ?
    WHERE id = ?
  `)
  for (const row of rows) {
    await update.run(fnResourceNameKey(row.name), row.id)
  }
  await (await portal.db.prepare(`
    CREATE TRIGGER IF NOT EXISTS actor_resources_name_key_before_insert
    BEFORE INSERT ON actor_resources
    FOR EACH ROW
    WHEN NEW.name_key IS NULL OR EXISTS (
      SELECT 1 FROM actor_resources WHERE name_key = NEW.name_key
    )
    BEGIN
      SELECT RAISE(ABORT, 'RESOURCE_NAME_CONFLICT');
    END
  `)).run()
  await (await portal.db.prepare(`
    CREATE TRIGGER IF NOT EXISTS actor_resources_name_key_before_update
    BEFORE UPDATE OF name_key ON actor_resources
    FOR EACH ROW
    WHEN NEW.name_key IS NULL OR (
      NEW.name_key IS NOT OLD.name_key
      AND EXISTS (
        SELECT 1
        FROM actor_resources AS collision
        WHERE collision.name_key = NEW.name_key AND collision.id <> OLD.id
      )
    )
    BEGIN
      SELECT RAISE(ABORT, 'RESOURCE_NAME_CONFLICT');
    END
  `)).run()
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
  if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1)) {
    throw new RangeError("Expected revision must be a positive integer")
  }
  const result = await (await portal.db.prepare(`
    DELETE FROM actor_resource_key_values
    WHERE resource_id = ? AND key = ?
      AND (? IS NULL OR revision = ?)
  `)).run(args.resourceId, args.key, args.expectedRevision ?? null, args.expectedRevision ?? null)
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
