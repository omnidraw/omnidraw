import type { Database } from "@tursodatabase/database"
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
    WHERE id = ?
  `)).get(args.id)
  return row === undefined || row === null ? null : fnParseDbResourceDraftRow(row)
}

export async function fxDbResourceDraftList(portal: TPortal, args: TArgsDraftList): Promise<TDbResourceDraft[]> {
  const limit = fnDbResourceDraftListLimit(args.limit)
  let rows: unknown[]
  if (args.status !== undefined && args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE resource_id = ? AND status = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, args.status, args.before.createdAt, args.before.createdAt, args.before.id, limit)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE resource_id = ? AND status = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, args.status, limit)
  } else if (args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE resource_id = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, args.before.createdAt, args.before.createdAt, args.before.id, limit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_drafts
      WHERE resource_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, limit)
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
    WHERE resource_id = ? AND status IN ('editing', 'applying')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `)).get(args.resourceId)
  return row === undefined || row === null ? null : fnParseDbResourceDraftRow(row)
}

export async function fxDbResourceDraftChangeList(
  portal: TPortal,
  args: TArgsDraftChangeList,
): Promise<TDbResourceDraftChange[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_draft_changes
    WHERE draft_id = ?
    ORDER BY sequence ASC
  `)).all(args.draftId)
  return rows.map(fnParseDbResourceDraftChangeRow)
}

export async function fxDbResourceApplyGet(portal: TPortal, args: TArgsApplyGet): Promise<TDbResourceApplyRun | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_apply_runs
    WHERE id = ?
  `)).get(args.id)
  return row === undefined || row === null ? null : fnParseDbResourceApplyRunRow(row)
}

export async function fxDbResourceApplyList(portal: TPortal, args: TArgsApplyList): Promise<TDbResourceApplyRun[]> {
  const limit = fnDbResourceApplyListLimit(args.limit)
  let rows: unknown[]
  if (args.status !== undefined && args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE resource_id = ? AND status = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, args.status, args.before.createdAt, args.before.createdAt, args.before.id, limit)
  } else if (args.status !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE resource_id = ? AND status = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, args.status, limit)
  } else if (args.before !== undefined) {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE resource_id = ?
        AND (created_at < ? OR (created_at = ? AND id < ?))
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, args.before.createdAt, args.before.createdAt, args.before.id, limit)
  } else {
    rows = await (await portal.db.prepare(`
      SELECT *
      FROM db_resource_apply_runs
      WHERE resource_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)).all(args.resourceId, limit)
  }
  return rows.map(fnParseDbResourceApplyRunRow)
}

export async function fxDbResourceApplyInstanceResultListByApply(
  portal: TPortal,
  args: TArgsApplyInstanceResultListByApply,
): Promise<TDbResourceApplyInstanceResult[]> {
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_apply_instance_results
    WHERE apply_id = ?
    ORDER BY actor_definition_name ASC, actor_instance_id ASC
  `)).all(args.applyId)
  return rows.map(fnParseDbResourceApplyInstanceResultRow)
}

export async function fxDbResourceApplyInstanceResultListByInstance(
  portal: TPortal,
  args: TArgsApplyInstanceResultListByInstance,
): Promise<TDbResourceApplyInstanceResult[]> {
  const rows = await (await portal.db.prepare(`
    SELECT db_resource_apply_instance_results.*
    FROM db_resource_apply_instance_results
    INNER JOIN db_resource_apply_runs
      ON db_resource_apply_runs.id = db_resource_apply_instance_results.apply_id
    WHERE db_resource_apply_instance_results.actor_instance_id = ?
    ORDER BY db_resource_apply_runs.created_at DESC, db_resource_apply_runs.id DESC
  `)).all(args.actorInstanceId)
  return rows.map(fnParseDbResourceApplyInstanceResultRow)
}

export async function fxDbResourceListAffectedInstances(
  portal: TPortal,
  args: TArgsListAffectedInstances,
): Promise<TActorInstance[]> {
  const rows = await (await portal.db.prepare(`
    SELECT DISTINCT actor_instances.*
    FROM actor_instances
    INNER JOIN actor_resource_bindings
      ON actor_resource_bindings.actor_definition_name = actor_instances.actor_definition_name
    WHERE actor_resource_bindings.resource_id = ?
    ORDER BY actor_instances.created_at ASC, actor_instances.id ASC
  `)).all(args.resourceId)
  return rows.map(fnParseActorInstanceRow)
}
