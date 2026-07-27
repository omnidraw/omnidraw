import type { TDbApiPortal, TDbCellValue, TDbRowIdentity } from "./types";

export type TPortal = TDbApiPortal;

export type TArgsRename = { resourceId: string; name: string };
export const txRename = (portal: TPortal, args: TArgsRename) =>
  portal.api.resources.rename({ resourceId: args.resourceId, name: args.name });

export type TArgsDeleteResource = { resourceId: string };
export const txDeleteResource = (portal: TPortal, args: TArgsDeleteResource) =>
  portal.api.resources.delete({ resourceId: args.resourceId });

export type TArgsCreateDraft = { resourceId: string; name: string };
export const txCreateDraft = (portal: TPortal, args: TArgsCreateDraft) =>
  portal.api.dbDrafts.create({ resourceId: args.resourceId, name: args.name });

export type TArgsDraftChange = { draftId: string; operation: Record<string, unknown> };
export const txDraftChange = (portal: TPortal, args: TArgsDraftChange) =>
  portal.api.dbDrafts.change({ draftId: args.draftId, operation: args.operation });

export type TArgsExecuteSql = { draftId: string; sql: string };
export const txExecuteSql = (portal: TPortal, args: TArgsExecuteSql) =>
  portal.api.dbDrafts.executeSql({ draftId: args.draftId, sql: args.sql });

export type TArgsExecuteLiveSql = { resourceId: string; sql: string; approved: boolean };
export const txExecuteLiveSql = (portal: TPortal, args: TArgsExecuteLiveSql) =>
  portal.api.dbResources.executeSql({ resourceId: args.resourceId, sql: args.sql, approved: args.approved });

export type TArgsDiscardDraft = { draftId: string };
export const txDiscardDraft = (portal: TPortal, args: TArgsDiscardDraft) =>
  portal.api.dbDrafts.discard({ draftId: args.draftId });

export type TArgsCreateRow = { resourceId: string; objectName: string; values: Record<string, TDbCellValue> };
export const txCreateRow = (portal: TPortal, args: TArgsCreateRow) =>
  portal.api.dbRows.create({ resourceId: args.resourceId, object: args.objectName, values: args.values });

export type TArgsUpdateRow = {
  resourceId: string;
  objectName: string;
  identity: TDbRowIdentity;
  expected: Record<string, TDbCellValue>;
  values: Record<string, TDbCellValue>;
};
export const txUpdateRow = (portal: TPortal, args: TArgsUpdateRow) =>
  portal.api.dbRows.update({
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    expectedOriginal: args.expected,
    values: args.values,
  });

export type TArgsDeleteRow = {
  resourceId: string;
  objectName: string;
  identity: TDbRowIdentity;
  expected: Record<string, TDbCellValue>;
};
export const txDeleteRow = (portal: TPortal, args: TArgsDeleteRow) =>
  portal.api.dbRows.delete({
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    expectedOriginal: args.expected,
  });

export type TArgsBulkDeleteRows = {
  resourceId: string;
  objectName: string;
  rows: Array<{ identity: TDbRowIdentity; expected: Record<string, TDbCellValue> }>;
};
export const txBulkDeleteRows = (portal: TPortal, args: TArgsBulkDeleteRows) =>
  portal.api.dbRows.bulk({
    resourceId: args.resourceId,
    object: args.objectName,
    operations: args.rows.map((row) => ({ kind: "delete", identity: row.identity, expectedOriginal: row.expected })),
  });

export type TArgsConfirmApply = { draftId: string };
export const txConfirmApply = (portal: TPortal, args: TArgsConfirmApply) =>
  portal.api.dbApplies.confirm({ draftId: args.draftId });

export type TArgsDiscardBackup = { resourceId: string; applyId: string };
export const txDiscardBackup = (portal: TPortal, args: TArgsDiscardBackup) =>
  portal.api.dbBackups.discard({ resourceId: args.resourceId, applyId: args.applyId });

export type TArgsRestoreBackup = { resourceId: string; applyId: string };
export const txRestoreBackup = (portal: TPortal, args: TArgsRestoreBackup) =>
  portal.api.dbBackups.restore({ resourceId: args.resourceId, applyId: args.applyId });
