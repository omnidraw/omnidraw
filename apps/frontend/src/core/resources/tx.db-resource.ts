import type {
  TDbApplyRun,
  TDbCellValue,
  TDbDraft,
  TDbDraftChange,
  TDbDraftDetails,
  TDbRowIdentity,
  TDbSqlResult,
  TResource,
} from "./types";
import { Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";
import { DbResources, dbResourceWrite } from "./service.db-resources";

export type TArgsRename = { resourceId: string; name: string };
export function txRename(args: TArgsRename): Effect.Effect<TResource, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.resources.rename", args);
}

export type TArgsDeleteResource = { resourceId: string };
export function txDeleteResource(args: TArgsDeleteResource): Effect.Effect<{ deleted: boolean }, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.resources.delete", args);
}

export type TArgsCreateDraft = { resourceId: string; name: string };
export function txCreateDraft(args: TArgsCreateDraft): Effect.Effect<TDbDraftDetails, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbDrafts.create", args);
}

export type TArgsDraftChange = { draftId: string; operation: Record<string, unknown> };
export function txDraftChange(args: TArgsDraftChange): Effect.Effect<TDbDraftChange, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbDrafts.change", args);
}

export type TArgsExecuteSql = { draftId: string; sql: string };
export function txExecuteSql(args: TArgsExecuteSql): Effect.Effect<TDbDraftChange, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbDrafts.executeSql", args);
}

export type TArgsExecuteLiveSql = { resourceId: string; sql: string; approved: boolean };
export function txExecuteLiveSql(args: TArgsExecuteLiveSql): Effect.Effect<TDbSqlResult, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbResources.executeSql", args);
}

export type TArgsDiscardDraft = { draftId: string };
export function txDiscardDraft(args: TArgsDiscardDraft): Effect.Effect<TDbDraft, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbDrafts.discard", args);
}

export type TArgsCreateRow = { resourceId: string; objectName: string; values: Record<string, TDbCellValue> };
export function txCreateRow(args: TArgsCreateRow): Effect.Effect<
  { rowsAffected: number; lastInsertRowId: TDbCellValue | null },
  TFrontendTransportFailure,
  DbResources
> {
  return dbResourceWrite("resource.dbRows.create", {
    resourceId: args.resourceId,
    object: args.objectName,
    values: args.values,
  });
}

export type TArgsUpdateRow = {
  resourceId: string;
  objectName: string;
  identity: TDbRowIdentity;
  expected: Record<string, TDbCellValue>;
  values: Record<string, TDbCellValue>;
};
export function txUpdateRow(args: TArgsUpdateRow): Effect.Effect<{ rowsAffected: number }, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbRows.update", {
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    expectedOriginal: args.expected,
    values: args.values,
  });
}

export type TArgsDeleteRow = {
  resourceId: string;
  objectName: string;
  identity: TDbRowIdentity;
  expected: Record<string, TDbCellValue>;
};
export function txDeleteRow(args: TArgsDeleteRow): Effect.Effect<{ rowsAffected: number }, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbRows.delete", {
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    expectedOriginal: args.expected,
  });
}

export type TArgsBulkDeleteRows = {
  resourceId: string;
  objectName: string;
  rows: Array<{ identity: TDbRowIdentity; expected: Record<string, TDbCellValue> }>;
};
export function txBulkDeleteRows(args: TArgsBulkDeleteRows): Effect.Effect<
  readonly Readonly<{ rowsAffected: number }>[],
  TFrontendTransportFailure,
  DbResources
> {
  return dbResourceWrite("resource.dbRows.bulk", {
    resourceId: args.resourceId,
    object: args.objectName,
    operations: args.rows.map((row) => ({
      kind: "delete",
      identity: row.identity,
      expectedOriginal: row.expected,
    })),
  });
}

export type TArgsConfirmApply = { draftId: string };
export function txConfirmApply(args: TArgsConfirmApply): Effect.Effect<TDbApplyRun, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbApplies.confirm", args);
}

export type TArgsDiscardBackup = { resourceId: string; applyId: string };
export function txDiscardBackup(args: TArgsDiscardBackup): Effect.Effect<{ discarded: boolean }, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbBackups.discard", args);
}

export type TArgsRestoreBackup = { resourceId: string; applyId: string };
export function txRestoreBackup(args: TArgsRestoreBackup): Effect.Effect<TDbApplyRun, TFrontendTransportFailure, DbResources> {
  return dbResourceWrite("resource.dbBackups.restore", args);
}
