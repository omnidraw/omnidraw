import type { Database } from '@tursodatabase/database';
import type {
  TDbResourceApplyRun,
  TDbResourceApplyStatus,
  TDbResourceDraft,
  TDbResourceDraftChange,
  TDbResourceDraftStatus,
} from '../model';
import {
  fnDbResourceApplyListLimit,
  fnDbResourceDraftListLimit,
  fnDbResourceTimestampCursor,
  fnParseDbResourceApplyRunRow,
  fnParseDbResourceDraftChangeRow,
  fnParseDbResourceDraftRow,
} from './fn.db-resource';

type TPortal = { db: Database };
type TArgsDraftGet = { id: string };
type TArgsDraftList = {
  resourceId: string;
  status?: TDbResourceDraftStatus;
  before?: { createdAtSec: string; id: string };
  limit?: number;
};
type TArgsDraftGetActive = { resourceId: string };
type TArgsDraftChangeList = { draftId: string };
type TArgsApplyGet = { id: string };
type TArgsApplyList = {
  resourceId: string;
  status?: TDbResourceApplyStatus;
  before?: { createdAtSec: string; id: string };
  limit?: number;
};

export async function fxDbResourceDraftGet(
  portal: TPortal,
  args: TArgsDraftGet,
): Promise<TDbResourceDraft | null> {
  const row = await (await portal.db.prepare(`
    SELECT * FROM db_resource_drafts WHERE id = ?
  `)).get(args.id);
  return row == null ? null : fnParseDbResourceDraftRow(row);
}

export async function fxDbResourceDraftList(
  portal: TPortal,
  args: TArgsDraftList,
): Promise<TDbResourceDraft[]> {
  const limit = fnDbResourceDraftListLimit(args.limit);
  const before = args.before === undefined
    ? undefined
    : fnDbResourceTimestampCursor(args.before.createdAtSec);
  const predicates = ['resource_id = ?'];
  const parameters: Array<string | number> = [args.resourceId];
  if (args.status !== undefined) {
    predicates.push('status = ?');
    parameters.push(args.status);
  }
  if (args.before !== undefined && before !== undefined) {
    predicates.push('(created_at_sec < ? OR (created_at_sec = ? AND id < ?))');
    parameters.push(before, before, args.before.id);
  }
  parameters.push(limit);
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_drafts
    WHERE ${predicates.join(' AND ')}
    ORDER BY created_at_sec DESC, id DESC
    LIMIT ?
  `)).all(...parameters);
  return rows.map(fnParseDbResourceDraftRow);
}

export async function fxDbResourceDraftGetActive(
  portal: TPortal,
  args: TArgsDraftGetActive,
): Promise<TDbResourceDraft | null> {
  const row = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_drafts
    WHERE resource_id = ? AND status IN ('editing', 'applying')
    ORDER BY created_at_sec DESC, id DESC
    LIMIT 1
  `)).get(args.resourceId);
  return row == null ? null : fnParseDbResourceDraftRow(row);
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
  `)).all(args.draftId);
  return rows.map(fnParseDbResourceDraftChangeRow);
}

export async function fxDbResourceApplyGet(
  portal: TPortal,
  args: TArgsApplyGet,
): Promise<TDbResourceApplyRun | null> {
  const row = await (await portal.db.prepare(`
    SELECT * FROM db_resource_apply_runs WHERE id = ?
  `)).get(args.id);
  return row == null ? null : fnParseDbResourceApplyRunRow(row);
}

export async function fxDbResourceApplyList(
  portal: TPortal,
  args: TArgsApplyList,
): Promise<TDbResourceApplyRun[]> {
  const limit = fnDbResourceApplyListLimit(args.limit);
  const before = args.before === undefined
    ? undefined
    : fnDbResourceTimestampCursor(args.before.createdAtSec);
  const predicates = ['resource_id = ?'];
  const parameters: Array<string | number> = [args.resourceId];
  if (args.status !== undefined) {
    predicates.push('status = ?');
    parameters.push(args.status);
  }
  if (args.before !== undefined && before !== undefined) {
    predicates.push('(created_at_sec < ? OR (created_at_sec = ? AND id < ?))');
    parameters.push(before, before, args.before.id);
  }
  parameters.push(limit);
  const rows = await (await portal.db.prepare(`
    SELECT *
    FROM db_resource_apply_runs
    WHERE ${predicates.join(' AND ')}
    ORDER BY created_at_sec DESC, id DESC
    LIMIT ?
  `)).all(...parameters);
  return rows.map(fnParseDbResourceApplyRunRow);
}
