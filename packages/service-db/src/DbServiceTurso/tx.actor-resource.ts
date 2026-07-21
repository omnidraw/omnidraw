import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type {
  TActorResource,
  TActorResourceBinding,
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
import { fxActorResourceFindByNameKey, fxActorResourceGet } from "./fx.actor-resource"

type TPortal = {
  db: Database
}

type TArgsCreate = {
  tenant: TTenantContext
  id: string
  kind: TActorResourceKind
  name: string
  status?: TActorResourceStatus
  lastError?: TJson | null
}

type TArgsAuditNames = { tenant: TTenantContext }

type TArgsRename = {
  tenant: TTenantContext
  id: string
  name: string
}

type TArgsUpdateProviderState = {
  tenant: TTenantContext
  id: string
  status?: TActorResourceStatus
  lastError?: TJson | null
}

type TArgsResourceId = {
  tenant: TTenantContext
  id: string
}

type TImmediateTransaction<T> = (() => Promise<T>) & {
  immediate: () => Promise<T>
}

type TArgsUpsertBinding = {
  tenant: TTenantContext
  definitionName: string
  slotName: string
  resourceId: string
  allowRead: boolean
  allowWrite: boolean
}

type TArgsRemoveBinding = {
  tenant: TTenantContext
  definitionName: string
  slotName: string
}

type TArgsReplaceBindings = {
  tenant: TTenantContext
  definitionName: string
  expectedBindings?: readonly {
    slotName: string
    resourceId: string
    allowRead: boolean
    allowWrite: boolean
  }[]
  bindings: readonly {
    slotName: string
    resourceId: string
    allowRead: boolean
    allowWrite: boolean
  }[]
}

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
  const conflicts = await fxActorResourceFindByNameKey(portal, {
    tenant: args.tenant,
    nameKey: normalized.value.key,
  })
  if (conflicts.length > 0) throw resourceNameConflictError(normalized.value.name)
  const insert = await portal.db.prepare(`
    INSERT INTO resource_catalog (
      org_id, id, kind, name, status, last_error_json, created_at_ms, updated_at_ms
    )
    VALUES (
      ?, ?, ?, ?, ?, ?,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    )
  `)
  const result = await insert.run(
    args.tenant.orgId,
    args.id,
    args.kind,
    normalized.value.name,
    args.status ?? "created",
    args.lastError === undefined || args.lastError === null ? null : fnSerializeJsonValue(args.lastError),
  ).catch((error) => rethrowResourceNameMutationError(error, normalized.value.name))
  if (result.changes === 0) {
    throw resourceNameConflictError(normalized.value.name)
  }
  const created = await fxActorResourceGet(portal, { tenant: args.tenant, id: args.id })
  if (!created) throw new Error("Failed to create actor resource")
  return created
}

export async function txActorResourceRename(portal: TPortal, args: TArgsRename): Promise<TActorResource | null> {
  const normalized = fnNormalizeResourceName(args.name)
  if (!normalized.ok) throw Object.assign(new Error(normalized.message), { code: normalized.code })
  const conflicts = await fxActorResourceFindByNameKey(portal, {
    tenant: args.tenant,
    nameKey: normalized.value.key,
  })
  if (conflicts.some((resource) => resource.id !== args.id)) {
    throw resourceNameConflictError(normalized.value.name)
  }
  const result = await (await portal.db.prepare(`
    UPDATE resource_catalog
    SET name = ?, updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)).run(normalized.value.name, args.tenant.orgId, args.id)
    .catch((error) => rethrowResourceNameMutationError(error, normalized.value.name))
  if (result.changes === 0) {
    const current = await fxActorResourceGet(portal, { tenant: args.tenant, id: args.id })
    if (!current) return null
    throw resourceNameConflictError(normalized.value.name)
  }
  return fxActorResourceGet(portal, { tenant: args.tenant, id: args.id })
}

export async function txActorResourceAuditNames(portal: TPortal, args: TArgsAuditNames): Promise<void> {
  void args
  const rows = await (await portal.db.prepare(`
    SELECT id, name
    FROM resource_catalog
    WHERE org_id = ?
    ORDER BY id ASC
  `)).all(args.tenant.orgId) as { id: string; name: string }[]
  const names = new Map<string, string>()
  for (const row of rows) {
    const key = fnResourceNameKey(row.name)
    const conflictingId = names.get(key)
    if (conflictingId !== undefined) {
      throw new Error(`Resources '${conflictingId}' and '${row.id}' have conflicting normalized names.`)
    }
    names.set(key, row.id)
  }
}

export async function txActorResourceUpdateProviderState(
  portal: TPortal,
  args: TArgsUpdateProviderState,
): Promise<TActorResource | null> {
  const hasStatus = args.status !== undefined
  const hasLastError = args.lastError !== undefined
  await (await portal.db.prepare(`
    UPDATE resource_catalog
    SET status = CASE WHEN ? THEN ? ELSE status END,
        last_error_json = CASE WHEN ? THEN ? ELSE last_error_json END,
        updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
  `)).run(
    hasStatus,
    args.status ?? null,
    hasLastError,
    args.lastError === undefined || args.lastError === null ? null : fnSerializeJsonValue(args.lastError),
    args.tenant.orgId,
    args.id,
  )
  return fxActorResourceGet(portal, { tenant: args.tenant, id: args.id })
}

export async function txActorResourceBeginDelete(portal: TPortal, args: TArgsResourceId): Promise<TActorResource | null> {
  const result = await (await portal.db.prepare(`
    UPDATE resource_catalog
    SET status = 'deleting', updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ?
      AND status IN ('created', 'ready', 'error', 'deleting')
      AND NOT EXISTS (
        SELECT 1
        FROM legacy_actor_resource_bindings
        WHERE org_id = resource_catalog.org_id AND resource_id = resource_catalog.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM resource_bindings
        WHERE org_id = resource_catalog.org_id AND resource_id = resource_catalog.id
      )
  `)).run(args.tenant.orgId, args.id)
  if (result.changes === 0) return null
  return fxActorResourceGet(portal, { tenant: args.tenant, id: args.id })
}

export async function txActorResourceDelete(portal: TPortal, args: TArgsResourceId): Promise<boolean> {
  const remove = portal.db.transaction(async () => {
    const eligible = await (await portal.db.prepare(`
      SELECT id
      FROM resource_catalog
      WHERE org_id = ? AND id = ?
        AND status = 'deleting'
        AND NOT EXISTS (
          SELECT 1
          FROM legacy_actor_resource_bindings
          WHERE org_id = resource_catalog.org_id AND resource_id = resource_catalog.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM resource_bindings
          WHERE org_id = resource_catalog.org_id AND resource_id = resource_catalog.id
        )
    `)).get(args.tenant.orgId, args.id)
    if (!eligible) return false

    // Apply-run lineage is RESTRICT by design. Clear it only inside the same
    // transaction that removes the complete resource history; a retained backup
    // still blocks deletion and rolls this update back.
    await (await portal.db.prepare(`
      UPDATE db_resource_apply_runs
      SET source_apply_id = NULL
      WHERE org_id = ? AND resource_id = ? AND source_apply_id IS NOT NULL
    `)).run(args.tenant.orgId, args.id)
    await (await portal.db.prepare(`
      DELETE FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ?
    `)).run(args.tenant.orgId, args.id)

    const result = await (await portal.db.prepare(`
      DELETE FROM resource_catalog
      WHERE org_id = ? AND id = ? AND status = 'deleting'
    `)).run(args.tenant.orgId, args.id)
    return result.changes > 0
  }) as TImmediateTransaction<boolean>
  return remove.immediate()
}

export async function txActorResourceUpsertBinding(
  portal: TPortal,
  args: TArgsUpsertBinding,
): Promise<TActorResourceBinding | null> {
  const result = await (await portal.db.prepare(`
    INSERT INTO legacy_actor_resource_bindings (
      org_id,
      definition_name,
      slot_name,
      resource_id,
      allow_read,
      allow_write,
      created_at_ms,
      updated_at_ms
    )
    SELECT ?, ?, ?, id, ?, ?,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER)
    FROM resource_catalog
    WHERE org_id = ? AND id = ? AND status = 'ready'
    ON CONFLICT (org_id, definition_name, slot_name) DO UPDATE SET
      resource_id = excluded.resource_id,
      allow_read = excluded.allow_read,
      allow_write = excluded.allow_write,
      updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  `)).run(
    args.tenant.orgId,
    args.definitionName,
    args.slotName,
    args.allowRead,
    args.allowWrite,
    args.tenant.orgId,
    args.resourceId,
  )
  if (result.changes === 0) return null
  const row = await (await portal.db.prepare(`
    SELECT definition_name, slot_name, resource_id, allow_read, allow_write,
      created_at_ms, updated_at_ms
    FROM legacy_actor_resource_bindings
    WHERE org_id = ? AND definition_name = ? AND slot_name = ?
  `)).get(args.tenant.orgId, args.definitionName, args.slotName)
  return row ? fnParseActorResourceBindingRow(row) : null
}

export async function txActorResourceRemoveBinding(portal: TPortal, args: TArgsRemoveBinding): Promise<boolean> {
  const result = await (await portal.db.prepare(`
    DELETE FROM legacy_actor_resource_bindings
    WHERE org_id = ? AND definition_name = ? AND slot_name = ?
  `)).run(args.tenant.orgId, args.definitionName, args.slotName)
  return result.changes > 0
}

export async function txActorResourceReplaceBindings(
  portal: TPortal,
  args: TArgsReplaceBindings,
): Promise<TActorResourceBinding[]> {
  if (new Set(args.bindings.map((binding) => binding.slotName)).size !== args.bindings.length) {
    throw new Error(`Definition '${args.definitionName}' has duplicate resource binding slots.`)
  }
  const replace = portal.db.transaction(async () => {
    if (args.expectedBindings) {
      const currentRows = await (await portal.db.prepare(`
        SELECT definition_name, slot_name, resource_id, allow_read, allow_write,
          created_at_ms, updated_at_ms
        FROM legacy_actor_resource_bindings
        WHERE org_id = ? AND definition_name = ?
        ORDER BY slot_name ASC
      `)).all(args.tenant.orgId, args.definitionName)
      const current = currentRows.map(fnParseActorResourceBindingRow)
      const expected = [...args.expectedBindings].sort((left, right) => left.slotName.localeCompare(right.slotName, "en-US"))
      const matches = current.length === expected.length && current.every((binding, index) => {
        const candidate = expected[index]
        return candidate !== undefined
          && binding.slot_name === candidate.slotName
          && binding.resource_id === candidate.resourceId
          && binding.allow_read === candidate.allowRead
          && binding.allow_write === candidate.allowWrite
      })
      if (!matches) {
        throw Object.assign(
          new Error(`Resource bindings for definition '${args.definitionName}' changed concurrently.`),
          { code: "RESOURCE_BINDING_CONFLICT" },
        )
      }
    }
    await (await portal.db.prepare(`
      DELETE FROM legacy_actor_resource_bindings
      WHERE org_id = ? AND definition_name = ?
    `)).run(args.tenant.orgId, args.definitionName)
    const insert = await portal.db.prepare(`
      INSERT INTO legacy_actor_resource_bindings (
        org_id,
        definition_name,
        slot_name,
        resource_id,
        allow_read,
        allow_write,
        created_at_ms,
        updated_at_ms
      )
      SELECT ?, ?, ?, id, ?, ?,
        CAST(unixepoch('subsec') * 1000 AS INTEGER),
        CAST(unixepoch('subsec') * 1000 AS INTEGER)
      FROM resource_catalog
      WHERE org_id = ? AND id = ? AND status = 'ready'
    `)
    for (const binding of args.bindings) {
      const result = await insert.run(
        args.tenant.orgId,
        args.definitionName,
        binding.slotName,
        binding.allowRead,
        binding.allowWrite,
        args.tenant.orgId,
        binding.resourceId,
      )
      if (result.changes === 0) {
        throw new Error(`Resource '${binding.resourceId}' is not ready for binding.`)
      }
    }
    const rows = await (await portal.db.prepare(`
      SELECT definition_name, slot_name, resource_id, allow_read, allow_write,
        created_at_ms, updated_at_ms
      FROM legacy_actor_resource_bindings
      WHERE org_id = ? AND definition_name = ?
      ORDER BY slot_name ASC
    `)).all(args.tenant.orgId, args.definitionName)
    return rows.map(fnParseActorResourceBindingRow)
  })
  return replace()
}
