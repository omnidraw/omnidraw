import { DATABASE_STATEMENTS } from '../statement-registry';
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

type TEffects = { db: Database };
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

export async function getDbResourceDraft(
  effects: TEffects,
  args: TArgsDraftGet,
): Promise<TDbResourceDraft | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceReadDraft)).get(args.id);
  return row == null ? null : fnParseDbResourceDraftRow(row);
}

export async function listDbResourceDrafts(
  effects: TEffects,
  args: TArgsDraftList,
): Promise<TDbResourceDraft[]> {
  const limit = fnDbResourceDraftListLimit(args.limit);
  const before = args.before === undefined
    ? undefined
    : fnDbResourceTimestampCursor(args.before.createdAtSec);
  const parameters: Array<string | number> = [args.resourceId];
  if (args.status !== undefined) {
    parameters.push(args.status);
  }
  if (args.before !== undefined && before !== undefined) {
    parameters.push(before, before, args.before.id);
  }
  parameters.push(limit);
  const statement = args.status === undefined
    ? before === undefined
      ? DATABASE_STATEMENTS.dbResourceReadListDrafts
      : DATABASE_STATEMENTS.dbResourceReadListDraftsBefore
    : before === undefined
      ? DATABASE_STATEMENTS.dbResourceReadListDraftsByStatus
      : DATABASE_STATEMENTS.dbResourceReadListDraftsByStatusBefore;
  const rows = await (await effects.db.prepare(statement)).all(...parameters);
  return rows.map(fnParseDbResourceDraftRow);
}

export async function getActiveDbResourceDraft(
  effects: TEffects,
  args: TArgsDraftGetActive,
): Promise<TDbResourceDraft | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceReadActiveDraft)).get(args.resourceId);
  return row == null ? null : fnParseDbResourceDraftRow(row);
}

export async function listDbResourceDraftChanges(
  effects: TEffects,
  args: TArgsDraftChangeList,
): Promise<TDbResourceDraftChange[]> {
  const rows = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceListDraftChanges)).all(args.draftId);
  return rows.map(fnParseDbResourceDraftChangeRow);
}

export async function getDbResourceApply(
  effects: TEffects,
  args: TArgsApplyGet,
): Promise<TDbResourceApplyRun | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.dbResourceReadApplyRun)).get(args.id);
  return row == null ? null : fnParseDbResourceApplyRunRow(row);
}

export async function listDbResourceApplies(
  effects: TEffects,
  args: TArgsApplyList,
): Promise<TDbResourceApplyRun[]> {
  const limit = fnDbResourceApplyListLimit(args.limit);
  const before = args.before === undefined
    ? undefined
    : fnDbResourceTimestampCursor(args.before.createdAtSec);
  const parameters: Array<string | number> = [args.resourceId];
  if (args.status !== undefined) {
    parameters.push(args.status);
  }
  if (args.before !== undefined && before !== undefined) {
    parameters.push(before, before, args.before.id);
  }
  parameters.push(limit);
  const statement = args.status === undefined
    ? before === undefined
      ? DATABASE_STATEMENTS.dbResourceReadListApplies
      : DATABASE_STATEMENTS.dbResourceReadListAppliesBefore
    : before === undefined
      ? DATABASE_STATEMENTS.dbResourceReadListAppliesByStatus
      : DATABASE_STATEMENTS.dbResourceReadListAppliesByStatusBefore;
  const rows = await (await effects.db.prepare(statement)).all(...parameters);
  return rows.map(fnParseDbResourceApplyRunRow);
}
