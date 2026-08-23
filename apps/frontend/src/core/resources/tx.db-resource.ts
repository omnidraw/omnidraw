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
export const txRename = Effect.fn('txRename')(function*(args: TArgsRename): Effect.fn.Return<TResource, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.resources.rename", args);
});

export type TArgsDeleteResource = { resourceId: string };
export const txDeleteResource = Effect.fn('txDeleteResource')(function*(args: TArgsDeleteResource): Effect.fn.Return<{ deleted: boolean }, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.resources.delete", args);
});

export type TArgsCreateDraft = { resourceId: string; name: string };
export const txCreateDraft = Effect.fn('txCreateDraft')(function*(args: TArgsCreateDraft): Effect.fn.Return<TDbDraftDetails, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbDrafts.create", args);
});

export type TArgsDraftChange = { draftId: string; operation: Record<string, unknown> };
export const txDraftChange = Effect.fn('txDraftChange')(function*(args: TArgsDraftChange): Effect.fn.Return<TDbDraftChange, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbDrafts.change", args);
});

export type TArgsExecuteSql = { draftId: string; sql: string };
export const txExecuteSql = Effect.fn('txExecuteSql')(function*(args: TArgsExecuteSql): Effect.fn.Return<TDbDraftChange, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbDrafts.executeSql", args);
});

export type TArgsExecuteLiveSql = { resourceId: string; sql: string; approved: boolean };
export const txExecuteLiveSql = Effect.fn('txExecuteLiveSql')(function*(args: TArgsExecuteLiveSql): Effect.fn.Return<TDbSqlResult, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbResources.executeSql", args);
});

export type TArgsDiscardDraft = { draftId: string };
export const txDiscardDraft = Effect.fn('txDiscardDraft')(function*(args: TArgsDiscardDraft): Effect.fn.Return<TDbDraft, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbDrafts.discard", args);
});

export type TArgsCreateRow = { resourceId: string; objectName: string; values: Record<string, TDbCellValue> };
export const txCreateRow = Effect.fn('txCreateRow')(function*(args: TArgsCreateRow): Effect.fn.Return<
  { rowsAffected: number; lastInsertRowId: TDbCellValue | null }, TFrontendTransportFailure, DbResources
> {
  return yield* dbResourceWrite("resource.dbRows.create", {
    resourceId: args.resourceId,
    object: args.objectName,
    values: args.values,
  });
});

export type TArgsUpdateRow = {
  resourceId: string;
  objectName: string;
  identity: TDbRowIdentity;
  expected: Record<string, TDbCellValue>;
  values: Record<string, TDbCellValue>;
};
export const txUpdateRow = Effect.fn('txUpdateRow')(function*(args: TArgsUpdateRow): Effect.fn.Return<{ rowsAffected: number }, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbRows.update", {
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    expectedOriginal: args.expected,
    values: args.values,
  });
});

export type TArgsDeleteRow = {
  resourceId: string;
  objectName: string;
  identity: TDbRowIdentity;
  expected: Record<string, TDbCellValue>;
};
export const txDeleteRow = Effect.fn('txDeleteRow')(function*(args: TArgsDeleteRow): Effect.fn.Return<{ rowsAffected: number }, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbRows.delete", {
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    expectedOriginal: args.expected,
  });
});

export type TArgsBulkDeleteRows = {
  resourceId: string;
  objectName: string;
  rows: Array<{ identity: TDbRowIdentity; expected: Record<string, TDbCellValue> }>;
};
export const txBulkDeleteRows = Effect.fn('txBulkDeleteRows')(function*(args: TArgsBulkDeleteRows): Effect.fn.Return<
  readonly Readonly<{ rowsAffected: number }>[], TFrontendTransportFailure, DbResources
> {
  return yield* dbResourceWrite("resource.dbRows.bulk", {
    resourceId: args.resourceId,
    object: args.objectName,
    operations: args.rows.map((row) => ({
      kind: "delete",
      identity: row.identity,
      expectedOriginal: row.expected,
    })),
  });
});

export type TArgsConfirmApply = { draftId: string };
export const txConfirmApply = Effect.fn('txConfirmApply')(function*(args: TArgsConfirmApply): Effect.fn.Return<TDbApplyRun, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbApplies.confirm", args);
});

export type TArgsDiscardBackup = { resourceId: string; applyId: string };
export const txDiscardBackup = Effect.fn('txDiscardBackup')(function*(args: TArgsDiscardBackup): Effect.fn.Return<{ discarded: boolean }, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbBackups.discard", args);
});

export type TArgsRestoreBackup = { resourceId: string; applyId: string };
export const txRestoreBackup = Effect.fn('txRestoreBackup')(function*(args: TArgsRestoreBackup): Effect.fn.Return<TDbApplyRun, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceWrite("resource.dbBackups.restore", args);
});
