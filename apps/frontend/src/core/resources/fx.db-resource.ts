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
export const fxResource = Effect.fn('fxResource')(function*(args: TArgsResource): Effect.fn.Return<TResource, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.resources.get", { resourceId: args.resourceId });
});

export type TArgsImpact = { resourceId: string };
export const fxImpact = Effect.fn('fxImpact')(function*(args: TArgsImpact): Effect.fn.Return<TDbImpact, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbResources.impact", { resourceId: args.resourceId });
});

export type TArgsInspectLive = { resourceId: string };
export const fxInspectLive = Effect.fn('fxInspectLive')(function*(args: TArgsInspectLive): Effect.fn.Return<TDbInspection | null, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbResources.inspect", { resourceId: args.resourceId, target: "live" });
});

export type TArgsDrafts = { resourceId: string };
export const fxDrafts = Effect.fn('fxDrafts')(function*(args: TArgsDrafts): Effect.fn.Return<readonly TDbDraft[], TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbDrafts.list", { resourceId: args.resourceId });
});

export type TArgsDraft = { draftId: string };
export const fxDraft = Effect.fn('fxDraft')(function*(args: TArgsDraft): Effect.fn.Return<TDbDraftDetails, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbDrafts.get", { draftId: args.draftId });
});

export type TArgsActiveDraft = { resourceId: string };
export const fxActiveDraft = Effect.fn('fxActiveDraft')(function*(args: TArgsActiveDraft): Effect.fn.Return<TDbDraftDetails | null, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbDrafts.active", { resourceId: args.resourceId });
});

export type TArgsInspectDraft = { resourceId: string; draftId: string };
export const fxInspectDraft = Effect.fn('fxInspectDraft')(function*(args: TArgsInspectDraft): Effect.fn.Return<TDbInspection | null, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbDrafts.inspect", args);
});

export type TArgsRows = { resourceId: string; objectName: string; cursor?: TDbRowIdentity; limit: number };
export const fxRows = Effect.fn('fxRows')(function*(args: TArgsRows): Effect.fn.Return<TDbRowPage, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbRows.list", {
    resourceId: args.resourceId,
    object: args.objectName,
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    limit: args.limit,
  });
});

export type TArgsRow = { resourceId: string; objectName: string; identity: TDbRowIdentity; columns?: string[] };
export const fxRow = Effect.fn('fxRow')(function*(args: TArgsRow): Effect.fn.Return<TDbRow, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbRows.get", {
    resourceId: args.resourceId,
    object: args.objectName,
    identity: args.identity,
    ...(args.columns === undefined ? {} : { columns: args.columns }),
  });
});

export type TArgsApplies = { resourceId: string; limit: number };
export const fxApplies = Effect.fn('fxApplies')(function*(args: TArgsApplies): Effect.fn.Return<readonly TDbApplyRun[], TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbApplies.list", args);
});

export type TArgsApplyPreview = { draftId: string };
export const fxApplyPreview = Effect.fn('fxApplyPreview')(function*(args: TArgsApplyPreview): Effect.fn.Return<TDbApplyPreview, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbApplies.preview", args);
});

export type TArgsApply = { applyId: string };
export const fxApply = Effect.fn('fxApply')(function*(args: TArgsApply): Effect.fn.Return<TDbApplyDetails, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbApplies.get", args);
});

export type TArgsBackup = { resourceId: string };
export const fxBackup = Effect.fn('fxBackup')(function*(args: TArgsBackup): Effect.fn.Return<TDbBackup, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbBackups.get", args);
});

export type TArgsRestorePreview = { resourceId: string; applyId: string };
export const fxRestorePreview = Effect.fn('fxRestorePreview')(function*(args: TArgsRestorePreview): Effect.fn.Return<TDbRestorePreview, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbBackups.previewRestore", args);
});

export type TArgsRestore = { restoreId: string };
export const fxRestore = Effect.fn('fxRestore')(function*(args: TArgsRestore): Effect.fn.Return<TDbApplyDetails, TFrontendTransportFailure, DbResources> {
  return yield* dbResourceRead("resource.dbBackups.restoreStatus", args);
});
