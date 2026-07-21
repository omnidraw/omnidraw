import type { Database } from "@tursodatabase/database"
import { DEFAULT_OSS_ORGANIZATION_ID } from "../CONSTANTS"
import type {
  TActorInstance,
  TDbResourceApplyInstanceResult,
  TDbResourceApplyRun,
  TDbResourceApplyStatus,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
} from "../model"
import { fnParseActorInstanceRow } from "./fn.actor-resource-row"
import {
  fnDbResourceApplyListLimit,
  fnDbResourceDraftListLimit,
  fnParseDbResourceApplyInstanceResultRow,
  fnParseDbResourceApplyRunRow,
  fnParseDbResourceDraftChangeRow,
  fnParseDbResourceDraftRow,
} from "./fn.db-resource"
import { fnTimestampToMs } from "./fn.legacy-row"

type TPortal = {
  db: Database
}

type TArgsDraftGet = {
  id: string
}

type TArgsDraftList = {
  resourceId: string
  status?: TDbResourceDraftStatus
  before?: { createdAt: string; id: string }
  limit?: number
}

type TArgsDraftGetActive = {
  resourceId: string
}

type TArgsDraftChangeList = {
  draftId: string
}

type TArgsApplyGet = {
  id: string
}

type TArgsApplyList = {
  resourceId: string
  status?: TDbResourceApplyStatus
  before?: { createdAt: string; id: string }
  limit?: number
}

type TArgsApplyInstanceResultListByApply = {
  applyId: string
}

type TArgsApplyInstanceResultListByInstance = {
  actorInstanceId: string
}

type TArgsListAffectedInstances = {
  resourceId: string
}

export async function fxDbResourceDraftGet(portal: TPortal, args: TArgsDraftGet): Promise<TDbResourceDraft | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_drafts
    WHERE org_id = ? AND id = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.id)
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
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, args.status, beforeMs, beforeMs, args.before.id, limit)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ? AND status = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, args.status, limit)
  } else if (args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ?
        AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, beforeMs, beforeMs, args.before.id, limit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE org_id = ? AND resource_id = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, limit)
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
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId)
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
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.draftId)
  return rows.map(fnParseDbResourceDraftChangeRow)
}

export async function fxDbResourceApplyGet(portal: TPortal, args: TArgsApplyGet): Promise<TDbResourceApplyRun | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_apply_runs
    WHERE org_id = ? AND id = ?
  `)).get(DEFAULT_OSS_ORGANIZATION_ID, args.id)
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
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, args.status, beforeMs, beforeMs, args.before.id, limit)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ? AND status = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, args.status, limit)
  } else if (args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ?
        AND (created_at_ms < ? OR (created_at_ms = ? AND id < ?))
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, beforeMs, beforeMs, args.before.id, limit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE org_id = ? AND resource_id = ?
      ORDER BY created_at_ms DESC, id DESC
      LIMIT ?
    `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId, limit)
  }
  return rows.map(fnParseDbResourceApplyRunRow)
}

export async function fxDbResourceApplyInstanceResultListByApply(
  portal: TPortal,
  args: TArgsApplyInstanceResultListByApply,
): Promise<TDbResourceApplyInstanceResult[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM legacy_actor_apply_results
    WHERE org_id = ? AND apply_id = ?
    ORDER BY actor_definition_name ASC, actor_instance_id ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.applyId)
  return rows.map(fnParseDbResourceApplyInstanceResultRow)
}

export async function fxDbResourceApplyInstanceResultListByInstance(
  portal: TPortal,
  args: TArgsApplyInstanceResultListByInstance,
): Promise<TDbResourceApplyInstanceResult[]> {
  const rows = await (await portal.db.prepare(`
    SELECT results.*
    FROM legacy_actor_apply_results AS results
    INNER JOIN db_resource_apply_runs
      ON db_resource_apply_runs.org_id = results.org_id
      AND db_resource_apply_runs.id = results.apply_id
    WHERE results.org_id = ? AND results.actor_instance_id = ?
    ORDER BY db_resource_apply_runs.created_at_ms DESC, db_resource_apply_runs.id DESC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.actorInstanceId)
  return rows.map(fnParseDbResourceApplyInstanceResultRow)
}

export async function fxDbResourceListAffectedInstances(
  portal: TPortal,
  args: TArgsListAffectedInstances,
): Promise<TActorInstance[]> {
  const rows = await (await portal.db.prepare(`
    SELECT DISTINCT instances.*
    FROM legacy_actor_instances AS instances
    INNER JOIN legacy_actor_resource_bindings AS bindings
      ON bindings.org_id = instances.org_id
      AND bindings.definition_name = instances.actor_definition_name
    WHERE instances.org_id = ? AND bindings.resource_id = ?
    ORDER BY instances.created_at_ms ASC, instances.id ASC
  `)).all(DEFAULT_OSS_ORGANIZATION_ID, args.resourceId)
  return rows.map(fnParseActorInstanceRow)
}
