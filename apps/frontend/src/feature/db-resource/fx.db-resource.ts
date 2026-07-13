import type { TDbApiPortal, TDbRowIdentity } from "./types";

export type TPortal = TDbApiPortal;

export type TArgsResource = { resourceId: string };
export const fxResource = (portal: TPortal, args: TArgsResource) =>
  portal.api.resources.get({ resourceId: args.resourceId });

export type TArgsImpact = { resourceId: string };
export const fxImpact = (portal: TPortal, args: TArgsImpact) =>
  portal.api.dbResources.impact({ resourceId: args.resourceId });

export type TArgsInspectLive = { resourceId: string };
export const fxInspectLive = (portal: TPortal, args: TArgsInspectLive) =>
  portal.api.dbResources.inspect({ resourceId: args.resourceId, target: "live" });

export type TArgsDrafts = { resourceId: string };
export const fxDrafts = (portal: TPortal, args: TArgsDrafts) =>
  portal.api.dbDrafts.list({ resourceId: args.resourceId });

export type TArgsDraft = { draftId: string };
export const fxDraft = (portal: TPortal, args: TArgsDraft) =>
  portal.api.dbDrafts.get({ draftId: args.draftId });

export type TArgsActiveDraft = { resourceId: string };
export const fxActiveDraft = (portal: TPortal, args: TArgsActiveDraft) =>
  portal.api.dbDrafts.active({ resourceId: args.resourceId });

export type TArgsInspectDraft = { resourceId: string; draftId: string };
export const fxInspectDraft = (portal: TPortal, args: TArgsInspectDraft) =>
  portal.api.dbDrafts.inspect({ resourceId: args.resourceId, draftId: args.draftId });

export type TArgsRows = { resourceId: string; objectName: string; cursor?: TDbRowIdentity; limit: number };
export const fxRows = (portal: TPortal, args: TArgsRows) =>
  portal.api.dbRows.list({ resourceId: args.resourceId, object: args.objectName, cursor: args.cursor, limit: args.limit });

export type TArgsRow = { resourceId: string; objectName: string; identity: TDbRowIdentity };
export const fxRow = (portal: TPortal, args: TArgsRow) =>
  portal.api.dbRows.get({ resourceId: args.resourceId, object: args.objectName, identity: args.identity });

export type TArgsApplies = { resourceId: string; limit: number };
export const fxApplies = (portal: TPortal, args: TArgsApplies) =>
  portal.api.dbApplies.list({ resourceId: args.resourceId, limit: args.limit });

export type TArgsApplyPreview = { draftId: string };
export const fxApplyPreview = (portal: TPortal, args: TArgsApplyPreview) =>
  portal.api.dbApplies.preview({ draftId: args.draftId });

export type TArgsApply = { applyId: string };
export const fxApply = (portal: TPortal, args: TArgsApply) =>
  portal.api.dbApplies.get({ applyId: args.applyId });

export type TArgsBackup = { resourceId: string };
export const fxBackup = (portal: TPortal, args: TArgsBackup) =>
  portal.api.dbBackups.get({ resourceId: args.resourceId });

export type TArgsRestorePreview = { resourceId: string; applyId: string };
export const fxRestorePreview = (portal: TPortal, args: TArgsRestorePreview) =>
  portal.api.dbBackups.previewRestore({ resourceId: args.resourceId, applyId: args.applyId });

export type TArgsRestore = { restoreId: string };
export const fxRestore = (portal: TPortal, args: TArgsRestore) =>
  portal.api.dbBackups.restoreStatus({ restoreId: args.restoreId });
