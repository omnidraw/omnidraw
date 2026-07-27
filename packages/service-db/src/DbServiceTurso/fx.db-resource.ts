import type { Database } from "@tursodatabase/database"
import type { TTenantContext } from "@vibecanvas/tenant-core"
import type {
  TDbResourceApplyRun,
  TDbResourceApplyStatus,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
} from "../model"
import {
  fnDbResourceApplyListLimit,
  fnDbResourceDraftListLimit,
  fnParseDbResourceApplyRunRow,
  fnParseDbResourceDraftChangeRow,
  fnParseDbResourceDraftRow,
} from "./fn.db-resource"
import { fnTimestampToMs } from "./fn.legacy-row"

type TPortal = {
  db: Database
}

type TArgsDraftGet = {
  tenant: TTenantContext
  id: string
}

type TArgsDraftList = {
  tenant: TTenantContext
  resourceId: string
  status?: TDbResourceDraftStatus
  before?: { createdAt: string; id: string }
  limit?: number
}

type TArgsDraftGetActive = {
  tenant: TTenantContext
  resourceId: string
}

type TArgsDraftChangeList = {
  tenant: TTenantContext
  draftId: string
}

type TArgsApplyGet = {
  tenant: TTenantContext
  id: string
}

type TArgsApplyList = {
  tenant: TTenantContext
  resourceId: string
  status?: TDbResourceApplyStatus
  before?: { createdAt: string; id: string }
  limit?: number
}

export async function fxDbResourceDraftGet(portal: TPortal, args: TArgsDraftGet): Promise<TDbResourceDraft | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_drafts
    WHERE org_id = ? AND id = ?
  `)).get(args.tenant.orgId, args.id)
  return row === undefined || row === null ? null : fnParseDbResourceDraftRow(row)
}

export async function fxDbResourceDraftList(portal: TPortal, args: TArgsDraftList): Promise<TDbResourceDraft[]> {
  const limit = fnDbResourceDraftListLimit(args.limit)
  const beforeMs = args.before === undefined ? undefined : fnTimestampToMs(args.before.createdAt)
  let rows: unknown[]
  if (args.status !== undefined && args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ? AND status = ?
        AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, args.status, beforeMs, beforeMs, args.before.id, limit)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ? AND status = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, args.status, limit)
  } else if (args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ?
        AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, beforeMs, beforeMs, args.before.id, limit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, limit)
  }
  return rows.map(fnParseDbResourceDraftRow)
}

export async function fxDbResourceDraftGetActive(
  portal: TPortal,
  args: TArgsDraftGetActive,
): Promise<TDbResourceDraft | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_drafts
    WHERE org_id = ? AND resource_id = ? AND status IN ('editing', 'applying')
    ORDER BY created_at_ms DESC, id DESC
    LIMIT 1
  `)).get(args.tenant.orgId, args.resourceId)
  return row === undefined || row === null ? null : fnParseDbResourceDraftRow(row)
}

export async function fxDbResourceDraftChangeList(
  portal: TPortal,
  args: TArgsDraftChangeList,
): Promise<TDbResourceDraftChange[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_draft_changes
    WHERE org_id = ? AND draft_id = ?
    ORDER BY sequence ASC
  `)).all(args.tenant.orgId, args.draftId)
  return rows.map(fnParseDbResourceDraftChangeRow)
}

export async function fxDbResourceApplyGet(portal: TPortal, args: TArgsApplyGet): Promise<TDbResourceApplyRun | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_apply_runs
    WHERE org_id = ? AND id = ?
  `)).get(args.tenant.orgId, args.id)
  return row === undefined || row === null ? null : fnParseDbResourceApplyRunRow(row)
}

export async function fxDbResourceApplyList(portal: TPortal, args: TArgsApplyList): Promise<TDbResourceApplyRun[]> {
  const limit = fnDbResourceApplyListLimit(args.limit)
  const beforeMs = args.before === undefined ? undefined : fnTimestampToMs(args.before.createdAt)
  let rows: unknown[]
  if (args.status !== undefined && args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ? AND status = ?
        AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, args.status, beforeMs, beforeMs, args.before.id, limit)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ? AND status = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, args.status, limit)
  } else if (args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ?
        AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, beforeMs, beforeMs, args.before.id, limit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(args.tenant.orgId, args.resourceId, limit)
  }
  return rows.map(fnParseDbResourceApplyRunRow)
}
