import type {
  TDbApplyDetails,
  TDbApplyPreview,
  TDbApplyRun,
  TDbBackup,
  TDbDraft,
  TDbDraftDetails,
  TDbImpact,
  TDbInspection,
  TDbRestorePreview,
  TDbRow,
  TDbRowIdentity,
  TDbRowPage,
  TResource,
} from "./types";
import { Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";
import { DbResources, dbResourceRead } from "./service.db-resources";

export type TArgsResource = { resourceId: string };
export function fxResource(args: TArgsResource): Effect.Effect<TResource, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.resources.get", { resourceId: args.resourceId });
}

export type TArgsImpact = { resourceId: string };
export function fxImpact(args: TArgsImpact): Effect.Effect<TDbImpact, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbResources.impact", { resourceId: args.resourceId });
}

export type TArgsInspectLive = { resourceId: string };
export function fxInspectLive(args: TArgsInspectLive): Effect.Effect<TDbInspection | null, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbResources.inspect", { resourceId: args.resourceId, target: "live" });
}

export type TArgsDrafts = { resourceId: string };
export function fxDrafts(args: TArgsDrafts): Effect.Effect<readonly TDbDraft[], TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbDrafts.list", { resourceId: args.resourceId });
}

export type TArgsDraft = { draftId: string };
export function fxDraft(args: TArgsDraft): Effect.Effect<TDbDraftDetails, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbDrafts.get", { draftId: args.draftId });
}

export type TArgsActiveDraft = { resourceId: string };
export function fxActiveDraft(args: TArgsActiveDraft): Effect.Effect<TDbDraftDetails | null, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbDrafts.active", { resourceId: args.resourceId });
}

export type TArgsInspectDraft = { resourceId: string; draftId: string };
export function fxInspectDraft(args: TArgsInspectDraft): Effect.Effect<TDbInspection | null, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbDrafts.inspect", args);
}

export type TArgsRows = { resourceId: string; objectName: string; cursor?: TDbRowIdentity; limit: number };
export function fxRows(args: TArgsRows): Effect.Effect<TDbRowPage, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbRows.list", {
    resourceId: args.resourceId,
    object: args.objectName,
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    limit: args.limit,
  });
}

export type TArgsRow = { resourceId: string; objectName: string; identity: TDbRowIdentity; columns?: string[] };
export function fxRow(args: TArgsRow): Effect.Effect<TDbRow, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbRows.get", {
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    ...(args.columns === undefined ? {} : { columns: args.columns }),
  });
}

export type TArgsApplies = { resourceId: string; limit: number };
export function fxApplies(args: TArgsApplies): Effect.Effect<readonly TDbApplyRun[], TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbApplies.list", args);
}

export type TArgsApplyPreview = { draftId: string };
export function fxApplyPreview(args: TArgsApplyPreview): Effect.Effect<TDbApplyPreview, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbApplies.preview", args);
}

export type TArgsApply = { applyId: string };
export function fxApply(args: TArgsApply): Effect.Effect<TDbApplyDetails, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbApplies.get", args);
}

export type TArgsBackup = { resourceId: string };
export function fxBackup(args: TArgsBackup): Effect.Effect<TDbBackup, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbBackups.get", args);
}

export type TArgsRestorePreview = { resourceId: string; applyId: string };
export function fxRestorePreview(args: TArgsRestorePreview): Effect.Effect<TDbRestorePreview, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbBackups.previewRestore", args);
}

export type TArgsRestore = { restoreId: string };
export function fxRestore(args: TArgsRestore): Effect.Effect<TDbApplyDetails, TFrontendTransportFailure, DbResources> {
  return dbResourceRead("resource.dbBackups.restoreStatus", args);
}
