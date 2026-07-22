import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type {
  TDbResourceApplyInstanceResult,
  TDbResourceApplyInstanceStatus,
  TDbResourceApplyRun,
  TDbResourceApplyStatus,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftChangeKind,
  TDbResourceDraftStatus,
  TActorResourceStatus,
  TJson,
} from "../model"
import { txRunDatabaseTransaction } from "../tx.run-database-transaction"
import { fnSerializeJsonValue } from "./fn.actor-resource-row"
import { fnParseDbResourceApplyInstanceResultRow, fnParseDbResourceDraftChangeRow } from "./fn.db-resource"
import { fxActorResourceGet } from "./fx.actor-resource"
import { fxDbResourceApplyGet, fxDbResourceDraftGet } from "./fx.db-resource"

type TPortal = {
  db: Database
}

type TArgsDraftCreate = {
  tenant: TTenantContext
  id: string
  resourceId: string
  name: string
}

type TArgsDraftRename = {
  tenant: TTenantContext
  id: string
  name: string
}

type TArgsDraftUpdateStatus = {
  tenant: TTenantContext
  id: string
  status: TDbResourceDraftStatus
  expectedStatus?: TDbResourceDraftStatus
  lastError?: TJson | null
}

type TArgsDraftAppendChange = {
  tenant: TTenantContext
  draftId: string
  sequence: number
  kind: TDbResourceDraftChangeKind
  operation?: TJson | null
  sql: string
}

type TArgsDraftDiscard = {
  tenant: TTenantContext
  id: string
  lastError?: TJson | null
}

type TArgsApplyCreate = {
  tenant: TTenantContext
  id: string
  resourceId: string
  draftId?: string | null
  sourceApplyId?: string | null
  status?: TDbResourceApplyStatus
}

type TArgsApplyCreateFromDraft = {
  tenant: TTenantContext
  id: string
  resourceId: string
  draftId: string
}

type TArgsApplyFinishWithDraft = {
  tenant: TTenantContext
  id: string
  draftId: string
  status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">
  expectedStatus?: TDbResourceApplyStatus
  draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">
  lastError?: TJson | null
  backupRetained?: boolean
}

type TArgsApplyUpdate = {
  tenant: TTenantContext
  id: string
  status: TDbResourceApplyStatus
  expectedStatus?: TDbResourceApplyStatus
  lastError?: TJson | null
  backupRetained?: boolean
}

type TArgsApplyInstanceResultUpsert = {
  tenant: TTenantContext
  applyId: string
  actorInstanceId: string
  actorDefinitionName: string
  wasRunning: boolean
  status: TDbResourceApplyInstanceStatus
  error?: TJson | null
}

function serializedJson(value: TJson | null | undefined): string | null {
  return value === null || value === undefined ? null : fnSerializeJsonValue(value)
}

async function requireDbResource(
  portal: TPortal,
  tenant: TTenantContext,
  resourceId: string,
  allowedStatuses: readonly TActorResourceStatus[],
): Promise<void> {
  const resource = await fxActorResourceGet(portal, { tenant, id: resourceId })
  if (!resource || resource.kind !== "db" || !allowedStatuses.includes(resource.status)) {
    throw new Error(`Actor resource "${resourceId}" is not an available DbResource`)
  }
}

export async function txDbResourceDraftCreate(portal: TPortal, args: TArgsDraftCreate): Promise<TDbResourceDraft> {
  await requireDbResource(portal, args.tenant, args.resourceId, ["ready"])
  await (await portal.db.prepare(`
    INSERT INTO db_resource_drafts (
      org_id, id, resource_id, resource_kind, name, status, last_error_json,
      created_at_ms, updated_at_ms, applied_at_ms
    )
    VALUES (
      ?, ?, ?, 'db', ?, 'editing', NULL,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      NULL
    )
  `)).run(args.tenant.orgId, args.id, args.resourceId, args.name)
  const draft = await fxDbResourceDraftGet(portal, { tenant: args.tenant, id: args.id })
  if (!draft) throw new Error(`Failed to create DbResource draft "${args.id}"`)
  return draft
}

export async function txDbResourceDraftRename(portal: TPortal, args: TArgsDraftRename): Promise<TDbResourceDraft | null> {
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_drafts
    SET name = ?, updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ? AND status = 'editing'
  `)).run(args.name, args.tenant.orgId, args.id)
  if (result.changes === 0) return null
  return fxDbResourceDraftGet(portal, args)
}

export async function txDbResourceDraftUpdateStatus(
  portal: TPortal,
  args: TArgsDraftUpdateStatus,
): Promise<TDbResourceDraft | null> {
  const lastError = serializedJson(args.lastError)
  const result = args.expectedStatus === undefined
    ? await (await portal.db.prepare(`
        UPDATE db_resource_drafts
        SET status = ?, last_error_json = ?,
          updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER),
          applied_at_ms = CASE
            WHEN ? = 'applied' THEN CAST(unixepoch('subsec') * 1000 AS INTEGER)
            ELSE NULL
          END
        WHERE org_id = ? AND id = ?
      `)).run(args.status, lastError, args.status, args.tenant.orgId, args.id)
    : await (await portal.db.prepare(`
        UPDATE db_resource_drafts
        SET status = ?, last_error_json = ?,
          updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER),
          applied_at_ms = CASE
            WHEN ? = 'applied' THEN CAST(unixepoch('subsec') * 1000 AS INTEGER)
            ELSE NULL
          END
        WHERE org_id = ? AND id = ? AND status = ?
      `)).run(
        args.status,
        lastError,
        args.status,
        args.tenant.orgId,
        args.id,
        args.expectedStatus,
      )
  if (result.changes === 0) return null
  return fxDbResourceDraftGet(portal, { tenant: args.tenant, id: args.id })
}

export async function txDbResourceDraftAppendChange(
  portal: TPortal,
  args: TArgsDraftAppendChange,
): Promise<TDbResourceDraftChange> {
  return txRunDatabaseTransaction({ database: portal.db }, {
    mode: "deferred",
    operation: async () => {
      const draft = await fxDbResourceDraftGet(portal, { tenant: args.tenant, id: args.draftId })
      if (!draft || draft.status !== "editing") {
        throw new Error(`DbResource draft "${args.draftId}" is not editable`)
      }
      const sequenceRow = await (await portal.db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM db_resource_draft_changes
        WHERE org_id = ? AND draft_id = ?
      `)).get(args.tenant.orgId, args.draftId) as { next_sequence: number } | undefined
      const sequence = sequenceRow?.next_sequence ?? 1
      if (sequence !== args.sequence) {
        throw new Error(`DbResource draft "${args.draftId}" physical and control sequences diverged`)
      }
      await (await portal.db.prepare(`
        INSERT INTO db_resource_draft_changes (
          org_id, draft_id, sequence, kind, operation_json, sql_text, created_at_ms
        )
        VALUES (?, ?, ?, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER))
      `)).run(
        args.tenant.orgId,
        args.draftId,
        args.sequence,
        args.kind,
        serializedJson(args.operation),
        args.sql,
      )
      const row = await (await portal.db.prepare(`
        SELECT *
        FROM db_resource_draft_changes
        WHERE org_id = ? AND draft_id = ? AND sequence = ?
      `)).get(args.tenant.orgId, args.draftId, args.sequence)
      if (row === undefined || row === null) throw new Error("Failed to persist DbResource draft change")
      return fnParseDbResourceDraftChangeRow(row)
    },
  })
}

export async function txDbResourceDraftDiscard(portal: TPortal, args: TArgsDraftDiscard): Promise<TDbResourceDraft | null> {
  const result = await (await portal.db.prepare(`
    UPDATE db_resource_drafts
    SET status = 'discarded', last_error_json = ?, applied_at_ms = NULL,
      updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    WHERE org_id = ? AND id = ? AND status IN ('editing', 'error')
  `)).run(serializedJson(args.lastError), args.tenant.orgId, args.id)
  if (result.changes === 0) return null
  return fxDbResourceDraftGet(portal, { tenant: args.tenant, id: args.id })
}

export async function txDbResourceApplyCreate(portal: TPortal, args: TArgsApplyCreate): Promise<TDbResourceApplyRun> {
  await requireDbResource(portal, args.tenant, args.resourceId, ["ready", "migrating"])
  if (args.draftId !== undefined && args.draftId !== null) {
    const draft = await fxDbResourceDraftGet(portal, { tenant: args.tenant, id: args.draftId })
    if (!draft || draft.resource_id !== args.resourceId || !["editing", "applying"].includes(draft.status)) {
      throw new Error(`DbResource draft "${args.draftId}" is not active for resource "${args.resourceId}"`)
    }
  }
  if (args.sourceApplyId !== undefined && args.sourceApplyId !== null) {
    const source = await fxDbResourceApplyGet(portal, { tenant: args.tenant, id: args.sourceApplyId })
    if (!source || source.resource_id !== args.resourceId || !source.backup_retained) {
      throw new Error(`DbResource retained backup "${args.sourceApplyId}" is not available for resource "${args.resourceId}"`)
    }
  }
  if (args.draftId != null && args.sourceApplyId != null) {
    throw new Error("DbResource work cannot be both a draft apply and a backup restore")
  }
  await (await portal.db.prepare(`
    INSERT INTO db_resource_apply_runs (
      org_id, id, resource_id, draft_id, source_apply_id, status,
      last_error_json, backup_retained, created_at_ms, completed_at_ms
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, NULL, 0,
      CAST(unixepoch('subsec') * 1000 AS INTEGER),
      CASE WHEN ? IN ('succeeded', 'failed', 'recovered')
        THEN CAST(unixepoch('subsec') * 1000 AS INTEGER) ELSE NULL END
    )
  `)).run(
    args.tenant.orgId,
    args.id,
    args.resourceId,
    args.draftId ?? null,
    args.sourceApplyId ?? null,
    args.status ?? "preparing",
    args.status ?? "preparing",
  )
  const apply = await fxDbResourceApplyGet(portal, { tenant: args.tenant, id: args.id })
  if (!apply) throw new Error(`Failed to create DbResource apply run "${args.id}"`)
  return apply
}

export async function txDbResourceApplyCreateFromDraft(
  portal: TPortal,
  args: TArgsApplyCreateFromDraft,
): Promise<{ apply: TDbResourceApplyRun; draft: TDbResourceDraft }> {
  return txRunDatabaseTransaction({ database: portal.db }, {
    mode: "deferred",
    operation: async () => {
      await requireDbResource(portal, args.tenant, args.resourceId, ["ready"])
      const draft = await fxDbResourceDraftGet(portal, { tenant: args.tenant, id: args.draftId })
      if (!draft || draft.resource_id !== args.resourceId || draft.status !== "editing") {
        throw new Error(`DbResource draft "${args.draftId}" is not editable for resource "${args.resourceId}"`)
      }
      const updatedDraft = await txDbResourceDraftUpdateStatus(portal, {
        tenant: args.tenant,
        id: args.draftId,
        status: "applying",
        expectedStatus: "editing",
        lastError: null,
      })
      if (!updatedDraft) throw new Error(`DbResource draft "${args.draftId}" changed before apply admission`)
      const apply = await txDbResourceApplyCreate(portal, {
        tenant: args.tenant,
        id: args.id,
        resourceId: args.resourceId,
        draftId: args.draftId,
        status: "preparing",
      })
      return { apply, draft: updatedDraft }
    },
  })
}

export async function txDbResourceApplyFinishWithDraft(
  portal: TPortal,
  args: TArgsApplyFinishWithDraft,
): Promise<{ apply: TDbResourceApplyRun; draft: TDbResourceDraft }> {
  return txRunDatabaseTransaction({ database: portal.db }, {
    mode: "deferred",
    operation: async () => {
      const apply = await txDbResourceApplyUpdate(portal, {
        tenant: args.tenant,
        id: args.id,
        status: args.status,
        expectedStatus: args.expectedStatus,
        lastError: args.lastError,
        backupRetained: args.backupRetained,
      })
      if (!apply || apply.draft_id !== args.draftId) throw new Error(`DbResource apply "${args.id}" changed before completion`)
      const draft = await txDbResourceDraftUpdateStatus(portal, {
        tenant: args.tenant,
        id: args.draftId,
        status: args.draftStatus,
        expectedStatus: "applying",
        lastError: args.lastError,
      })
      if (!draft) throw new Error(`DbResource draft "${args.draftId}" changed before apply completion`)
      return { apply, draft }
    },
  })
}

export async function txDbResourceApplyUpdate(portal: TPortal, args: TArgsApplyUpdate): Promise<TDbResourceApplyRun | null> {
  const terminal = ["succeeded", "failed", "recovered"].includes(args.status)
  const result = args.expectedStatus === undefined
    ? await (await portal.db.prepare(`
        UPDATE db_resource_apply_runs
        SET status = ?, last_error_json = ?,
          backup_retained = COALESCE(?, backup_retained),
          completed_at_ms = CASE
            WHEN ? THEN COALESCE(completed_at_ms, CAST(unixepoch('subsec') * 1000 AS INTEGER))
            ELSE NULL
          END
        WHERE org_id = ? AND id = ?
      `)).run(
        args.status,
        serializedJson(args.lastError),
        args.backupRetained === undefined ? null : Number(args.backupRetained),
        terminal,
        args.tenant.orgId,
        args.id,
      )
    : await (await portal.db.prepare(`
        UPDATE db_resource_apply_runs
        SET status = ?, last_error_json = ?,
          backup_retained = COALESCE(?, backup_retained),
          completed_at_ms = CASE
            WHEN ? THEN COALESCE(completed_at_ms, CAST(unixepoch('subsec') * 1000 AS INTEGER))
            ELSE NULL
          END
        WHERE org_id = ? AND id = ? AND status = ?
      `)).run(
        args.status,
        serializedJson(args.lastError),
        args.backupRetained === undefined ? null : Number(args.backupRetained),
        terminal,
        args.tenant.orgId,
        args.id,
        args.expectedStatus,
      )
  if (result.changes === 0) return null
  return fxDbResourceApplyGet(portal, { tenant: args.tenant, id: args.id })
}

export async function txDbResourceApplyInstanceResultUpsert(
  portal: TPortal,
  args: TArgsApplyInstanceResultUpsert,
): Promise<TDbResourceApplyInstanceResult> {
  await (await portal.db.prepare(`
    INSERT INTO legacy_actor_apply_results (
      org_id,
      apply_id,
      actor_instance_id,
      actor_definition_name,
      was_running,
      status,
      error_json,
      updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CAST(unixepoch('subsec') * 1000 AS INTEGER))
    ON CONFLICT (org_id, apply_id, actor_instance_id) DO UPDATE SET
      actor_definition_name = excluded.actor_definition_name,
      was_running = excluded.was_running,
      status = excluded.status,
      error_json = excluded.error_json,
      updated_at_ms = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  `)).run(
    args.tenant.orgId,
    args.applyId,
    args.actorInstanceId,
    args.actorDefinitionName,
    args.wasRunning,
    args.status,
    serializedJson(args.error),
  )
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM legacy_actor_apply_results
    WHERE org_id = ? AND apply_id = ? AND actor_instance_id = ?
  `)).get(args.tenant.orgId, args.applyId, args.actorInstanceId)
  if (row === undefined || row === null) throw new Error("Failed to persist DbResource apply instance result")
  return fnParseDbResourceApplyInstanceResultRow(row)
}
