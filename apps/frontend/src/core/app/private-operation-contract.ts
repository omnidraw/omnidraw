import { Schema } from "effect";
import type {
  TCanvasCommand,
  TCanvasEvent,
  TCanvasItemPage,
  TCanvasItemQuery,
  TCanvasItemsChangedEvent,
  TCanvasSnapshot,
} from "@omnidraw/canvas-contract";
import type {
  TAiChatApproval,
  TAiChatApprovalPolicy,
  TAiChatLoginStatus,
  TAiChatSettings,
} from "@omnidraw/component-ai-chat";
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetHostConfiguration,
  TWidgetHostSubject,
  TWidgetPlacementRef,
  TWidgetPresentationProjection,
  TWidgetResourceRequirement,
  TWidgetSerializableJsonValue,
} from "@omnidraw/sdk";
import type { TBackendCanvas, TBackendResource, TNotificationEvent } from "./backend.types";
import type {
  TDbApplyDetails,
  TDbApplyPreview,
  TDbApplyRun,
  TDbBackup,
  TDbCellValue,
  TDbDraft,
  TDbDraftChange,
  TDbDraftDetails,
  TDbImpact,
  TDbInspection,
  TDbRestorePreview,
  TDbRow,
  TDbRowIdentity,
  TDbRowPage,
  TDbSqlResult,
} from "../resources/types";

type TOperation<Input, Output> = Readonly<{
  input: Input;
  output: Output;
}>;

export type TCanvasDeletionPlan = Readonly<{
  canvas: Required<TBackendCanvas>;
  itemCount: number;
  mediaCount: number;
  retainedChatCount: number;
}>;

export type TCanvasDeletionResult = Readonly<{
  canvas: Required<TBackendCanvas>;
  cleanup: Readonly<{
    itemCount: number;
    mediaCount: number;
    retainedChatCount: number;
  }>;
}>;

type TChatScope = Readonly<{ widgetId: string; sessionId: string }>;
type TThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type TModelRef = Readonly<{ provider: string; modelId: string }>;
type TChatHistoryItem = Readonly<{ entryId: string; message: unknown }>;
type TChatConnect = Readonly<{ vcJson: unknown | null; messageHistory: readonly TChatHistoryItem[] }>;
type TChatDbChangeProposal = Readonly<{
  id: string;
  resourceId: string;
  resourceName: string;
  sql: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  proposedAt: string;
  resolvedAt?: string;
  draftId?: string;
  applyId?: string;
  warnings?: readonly string[];
}>;
type TApprovalResolution = Readonly<{
  resolved: true;
  decision: "approve" | "reject";
  decisionSource: "user";
}>;
type TFunctionResult =
  | Readonly<{
      status: "succeeded";
      output: unknown;
      diagnostics: Readonly<{ code: string | null; message: string | null; logByteSize: number; truncated: boolean }>;
    }>
  | Readonly<{
      status: "failed" | "cancelled" | "timed_out";
      output: null;
      failure: Readonly<{ owner: "user" | "platform" | "cancelled"; code: string; message: string }>;
      diagnostics: Readonly<{ code: string | null; message: string | null; logByteSize: number; truncated: boolean }>;
    }>;

export type TWidgetPublicIssue = Readonly<{ code: string; message: string }>;
export type TWidgetPublicCatalogForm = Readonly<{
  source: "draft" | "published";
  health: "healthy" | "unhealthy";
  manifestDigestSha256: string | null;
  config: TWidgetPresentationProjection | null;
  resources: readonly TWidgetResourceRequirement[];
  functions: readonly TWidgetBrowserFunctionDescriptor[];
  fileCount: number;
  issues: readonly TWidgetPublicIssue[];
}>;
export type TWidgetPublicCatalogDifferences = Readonly<{
  availability: "draft-only" | "published-only" | "draft-and-published";
  manifest: "same" | "different" | "unavailable";
  presentation: "same" | "different" | "unavailable";
  executableManifest: "same" | "different" | "unavailable";
  status: "draft-only" | "published-only" | "matched" | "presentation-changed" | "executable-changed" | "unavailable";
}>;
export type TWidgetPublicCatalogEntry = Readonly<{
  widgetKey: string;
  health: "healthy" | "degraded" | "unhealthy";
  placeable: boolean;
  differences: TWidgetPublicCatalogDifferences;
  draft: TWidgetPublicCatalogForm | null;
  published: TWidgetPublicCatalogForm | null;
  placement: Readonly<{
    reference: Extract<TWidgetPlacementRef, { source: "published" }>;
    bounds: Readonly<{ width: number; height: number }>;
  }> | null;
}>;
export type TWidgetPublicCatalog = Readonly<{
  format: "omnidraw.widget-catalog.public.v1";
  generation: number;
  catalogDigestSha256: string;
  healthy: boolean;
  groups: readonly string[];
  entries: readonly TWidgetPublicCatalogEntry[];
  issues: readonly TWidgetPublicIssue[];
}>;
export type TWidgetPublicFileEntry = Readonly<{ path: string; kind: "file" | "directory"; byteSize: number }>;
export type TWidgetPublicFileList = Readonly<{ entries: readonly TWidgetPublicFileEntry[]; truncated: boolean }>;
export type TWidgetPublicFilePreview = Readonly<{ path: string; byteSize: number; binary: boolean; truncated: boolean; text: string | null }>;
export type TWidgetPublicMutationResult = Readonly<{ widgetKey: string; generation: number; catalogDigestSha256: string }>;
export type TWidgetPublicDeletionPlan = Readonly<{
  planToken: string;
  widgetKey: string;
  source: "draft" | "published";
  catalogDigestSha256: string;
  pairedDraftPresent: boolean;
  placementCount: number;
  previewPlacementCount: number;
  publishedPlacementCount: number;
  chatMountCount: number;
  resourcesPreserved: true;
}>;
export type TWidgetPublicDeletionResult = Readonly<{
  status: "committed";
  operationId: string;
  widgetKey: string;
  source: "draft" | "published";
  generation: number;
  catalogDigestSha256: string;
  removedPlacementCount: number;
  removedChatMountCount: number;
  resourcesPreserved: true;
}>;
export type TWidgetTransportArtifact = Readonly<{
  artifact: Readonly<{ bytesBase64: string; digestSha256: string }>;
  runtimeDescriptor?: unknown;
  runtime?: unknown;
  functionDescriptors?: readonly TWidgetBrowserFunctionDescriptor[];
  identity?: Readonly<{ catalogGeneration?: number }>;
}> & Readonly<Record<string, unknown>>;
type TWidgetStateIdentity = Pick<TWidgetHostSubject, "canvasId" | "elementId" | "widgetInstanceId">;
type TWidgetStateSnapshot = Readonly<{
  identity?: TWidgetStateIdentity;
  version: number;
  state: TWidgetSerializableJsonValue;
}>;
export type TWidgetStateResult =
  | Readonly<{ status: "found" | "changed" | "conflict"; snapshot: TWidgetStateSnapshot }>
  | Readonly<{ status: "rate-limited"; retryAfterMs: number }>
  | Readonly<{ status: "unavailable" }>;

type TResourceDataPage =
  | Readonly<{
      kind: "kv";
      entries: readonly Readonly<{ key: string; valuePreview: string; valueTruncated: boolean; revision: number; createdAtSec: string; updatedAtSec: string }>[];
      nextCursor: string | null;
    }>
  | Readonly<{
      kind: "secretStore";
      entries: readonly Readonly<{ name: string; revision: number; createdAtSec: string; updatedAtSec: string }>[];
      nextCursor: string | null;
    }>;

/**
 * Frontend-owned, finite mirror of every backend request contract. Calls are
 * indexed by their literal operation, so a result type can no longer be
 * selected independently from its path and input.
 */
export type TPrivateRequestOperations = Readonly<{
  "agent.settings.get": TOperation<Readonly<Record<string, never>> | undefined, TAiChatSettings>;
  "agent.settings.approvalPolicy.update": TOperation<TAiChatApprovalPolicy, TAiChatApprovalPolicy>;
  "agent.auth.login": TOperation<Readonly<{ providerId: "openai-codex" | "github-copilot" }>, Readonly<{ loginId: string }>>;
  "agent.auth.logout": TOperation<Readonly<{ providerId: "openai-codex" | "github-copilot" }>, Readonly<{ providerId: string }>>;
  "agent.auth.status": TOperation<Readonly<{ loginId: string }>, TAiChatLoginStatus>;
  "agent.auth.abort": TOperation<Readonly<{ loginId: string }>, null>;
  "agent.auth.apiKey.set": TOperation<Readonly<{ providerId: string; key: string }>, Readonly<{ providerId: string }>>;
  "agent.auth.apiKey.remove": TOperation<Readonly<{ providerId: string }>, Readonly<{ providerId: string }>>;
  "agent.chat.connect": TOperation<TChatScope & Readonly<{ canvasId: string; mode?: "reuse" | "replace" }>, TChatConnect>;
  "agent.chat.history": TOperation<TChatScope, readonly TChatHistoryItem[]>;
  "agent.chat.prompt": TOperation<TChatScope & Readonly<{
    canvasId: string;
    text: string;
    widgetRefs?: readonly Readonly<{ name: string; source: "published" | "draft" }>[];
    images?: readonly Readonly<{ name?: string; mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string }>[];
    model?: TModelRef;
    thinkingLevel?: TThinkingLevel;
  }>, null>;
  "agent.chat.edit": TOperation<TChatScope & Readonly<{ canvasId: string; entryId: string; text: string; model?: TModelRef; thinkingLevel?: TThinkingLevel }>, readonly TChatHistoryItem[]>;
  "agent.chat.dbChange.approve": TOperation<TChatScope & Readonly<{ proposalId: string; confirmedRisk: true }>, TChatDbChangeProposal>;
  "agent.chat.dbChange.reject": TOperation<TChatScope & Readonly<{ proposalId: string }>, TChatDbChangeProposal>;
  "agent.chat.approval.list": TOperation<TChatScope, readonly TAiChatApproval[]>;
  "agent.chat.approval.get": TOperation<TChatScope & Readonly<{ approvalId: string }>, TAiChatApproval | null>;
  "agent.chat.approval.resolve": TOperation<TChatScope & Readonly<{ approvalId: string; decision: "approve" | "reject" }>, TApprovalResolution>;
  "agent.chat.cancel": TOperation<TChatScope, Readonly<{ canceled: boolean; running: boolean }>>;
  "agent.chat.newSession": TOperation<TChatScope, null>;
  "agent.approval.list": TOperation<TChatScope, readonly TAiChatApproval[]>;
  "agent.approval.get": TOperation<TChatScope & Readonly<{ approvalId: string }>, TAiChatApproval | null>;
  "agent.approval.resolve": TOperation<TChatScope & Readonly<{ approvalId: string; decision: "approve" | "reject" }>, TApprovalResolution>;
  "canvas.list": TOperation<Readonly<Record<string, never>> | undefined, readonly TBackendCanvas[]>;
  "canvas.get": TOperation<Readonly<{ params: Readonly<{ id: string }> }>, Readonly<{ canvas: readonly TBackendCanvas[] }>>;
  "canvas.create": TOperation<Readonly<{ name: string }>, TBackendCanvas>;
  "canvas.update": TOperation<Readonly<{ params: Readonly<{ id: string }>; body: Readonly<{ name?: string }> }>, TBackendCanvas>;
  "canvas.deletionPlan": TOperation<Readonly<{ canvasId: string }>, TCanvasDeletionPlan>;
  "canvas.remove": TOperation<Readonly<{ deletionId: string; plan: TCanvasDeletionPlan }>, TCanvasDeletionResult>;
  "canvas.snapshot": TOperation<Readonly<{ canvasId: string }>, TCanvasSnapshot>;
  "canvas.query": TOperation<TCanvasItemQuery, TCanvasItemPage>;
  "canvas.execute": TOperation<TCanvasCommand, TCanvasItemsChangedEvent>;
  "file.put": TOperation<Readonly<{ body: Readonly<{ data: Blob | Uint8Array; mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp" }> }>, Readonly<{ url: string }>>;
  "file.clone": TOperation<Readonly<{ body: Readonly<{ url: string }> }>, Readonly<{ url: string }>>;
  "file.remove": TOperation<Readonly<{ body: Readonly<{ url: string }> }>, Readonly<{ ok: true }>>;
  "function.invoke": TOperation<Readonly<{ canvasId: string; elementId: string; widgetInstanceId: string; widgetKey: string; catalogGeneration: number; functionName: string; input: unknown }>, TFunctionResult>;
  "resource.resources.list": TOperation<Readonly<{ kind?: TBackendResource["kind"]; status?: TBackendResource["status"] }> | undefined, readonly TBackendResource[]>;
  "resource.resources.get": TOperation<Readonly<{ resourceId: string }>, TBackendResource>;
  "resource.resources.create": TOperation<Readonly<{ kind: TBackendResource["kind"]; name: string }>, TBackendResource>;
  "resource.resources.rename": TOperation<Readonly<{ resourceId: string; name: string }>, TBackendResource>;
  "resource.resources.delete": TOperation<Readonly<{ resourceId: string }>, Readonly<{ deleted: boolean }>>;
  "resource.resources.data": TOperation<Readonly<{ resourceId: string; prefix?: string; cursor?: string; limit?: number }>, TResourceDataPage>;
  "resource.resources.dataSet": TOperation<Readonly<{ resourceId: string; key: string; expectedRevision: number | null; value: unknown }>, unknown>;
  "resource.resources.dataDelete": TOperation<Readonly<{ resourceId: string; key: string; expectedRevision: number }>, Readonly<{ deleted: true }>>;
  "resource.resources.dataRevealSecret": TOperation<Readonly<{ resourceId: string; name: string }>, Readonly<{ kind: "secretStore"; name: string; value: string; revision: number }>>;
  "resource.dbResources.impact": TOperation<Readonly<{ resourceId: string }>, TDbImpact>;
  "resource.dbResources.inspect": TOperation<Readonly<{ resourceId: string; target: "live" | "draft"; draftId?: string }>, TDbInspection | null>;
  "resource.dbResources.executeSql": TOperation<Readonly<{ resourceId: string; sql: string; parameters?: Readonly<Record<string, TDbCellValue>>; approved: boolean }>, TDbSqlResult>;
  "resource.dbRows.list": TOperation<Readonly<{ resourceId: string; object: string; cursor?: TDbRowIdentity | null; limit?: number }>, TDbRowPage>;
  "resource.dbRows.get": TOperation<Readonly<{ resourceId: string; object: string; identity: TDbRowIdentity; columns?: readonly string[] }>, TDbRow>;
  "resource.dbRows.create": TOperation<Readonly<{ resourceId: string; object: string; values: Readonly<Record<string, TDbCellValue>> }>, Readonly<{ rowsAffected: number; lastInsertRowId: TDbCellValue | null }>>;
  "resource.dbRows.update": TOperation<Readonly<{ resourceId: string; object: string; identity: TDbRowIdentity; values: Readonly<Record<string, TDbCellValue>>; expectedOriginal: Readonly<Record<string, TDbCellValue>> }>, Readonly<{ rowsAffected: number }>>;
  "resource.dbRows.delete": TOperation<Readonly<{ resourceId: string; object: string; identity: TDbRowIdentity; expectedOriginal: Readonly<Record<string, TDbCellValue>> }>, Readonly<{ rowsAffected: number }>>;
  "resource.dbRows.bulk": TOperation<Readonly<{ resourceId: string; object: string; operations: readonly (
    | Readonly<{ kind: "create"; values: Readonly<Record<string, TDbCellValue>> }>
    | Readonly<{ kind: "update"; identity: TDbRowIdentity; values: Readonly<Record<string, TDbCellValue>>; expectedOriginal: Readonly<Record<string, TDbCellValue>> }>
    | Readonly<{ kind: "delete"; identity: TDbRowIdentity; expectedOriginal: Readonly<Record<string, TDbCellValue>> }>
  )[] }>, readonly Readonly<{ rowsAffected: number }>[]>;
  "resource.dbDrafts.create": TOperation<Readonly<{ resourceId: string; name: string }>, TDbDraftDetails>;
  "resource.dbDrafts.list": TOperation<Readonly<{ resourceId: string; before?: Readonly<{ createdAtSec: string; id: string }>; limit?: number }>, readonly TDbDraft[]>;
  "resource.dbDrafts.get": TOperation<Readonly<{ draftId: string }>, TDbDraftDetails>;
  "resource.dbDrafts.active": TOperation<Readonly<{ resourceId: string }>, TDbDraftDetails | null>;
  "resource.dbDrafts.inspect": TOperation<Readonly<{ resourceId: string; draftId?: string }>, TDbInspection | null>;
  "resource.dbDrafts.change": TOperation<Readonly<{ draftId: string; operation: Record<string, unknown> }>, TDbDraftChange>;
  "resource.dbDrafts.executeSql": TOperation<Readonly<{ draftId: string; sql: string }>, TDbDraftChange>;
  "resource.dbDrafts.discard": TOperation<Readonly<{ draftId: string }>, TDbDraft>;
  "resource.dbApplies.preview": TOperation<Readonly<{ draftId: string }>, TDbApplyPreview>;
  "resource.dbApplies.confirm": TOperation<Readonly<{ draftId: string }>, TDbApplyRun>;
  "resource.dbApplies.get": TOperation<Readonly<{ applyId: string }>, TDbApplyDetails>;
  "resource.dbApplies.list": TOperation<Readonly<{ resourceId: string; before?: Readonly<{ createdAtSec: string; id: string }>; limit?: number }>, readonly TDbApplyRun[]>;
  "resource.dbBackups.get": TOperation<Readonly<{ resourceId: string }>, TDbBackup>;
  "resource.dbBackups.discard": TOperation<Readonly<{ resourceId: string; applyId: string }>, Readonly<{ discarded: boolean }>>;
  "resource.dbBackups.previewRestore": TOperation<Readonly<{ resourceId: string; applyId: string }>, TDbRestorePreview>;
  "resource.dbBackups.restore": TOperation<Readonly<{ resourceId: string; applyId: string }>, TDbApplyRun>;
  "resource.dbBackups.restoreStatus": TOperation<Readonly<{ restoreId: string }>, TDbApplyDetails>;
  "widget.catalog.get": TOperation<Readonly<Record<string, never>> | undefined, TWidgetPublicCatalog>;
  "widget.catalog.refresh": TOperation<Readonly<Record<string, never>>, TWidgetPublicCatalog>;
  "widget.catalog.files.list": TOperation<Readonly<{ widgetKey: string; source: "draft" | "published" }>, TWidgetPublicFileList>;
  "widget.catalog.files.read": TOperation<Readonly<{ widgetKey: string; source: "draft" | "published"; path: string }>, TWidgetPublicFilePreview>;
  "widget.config.saveDraft": TOperation<Readonly<{ widgetKey: string; expectedManifestDigestSha256: string; config: Readonly<{ name: string; description: string; tool: Readonly<{ label: string; icon: unknown | null; group: string | null; priority: number }> }> }>, TWidgetPublicMutationResult>;
  "widget.deletion.plan": TOperation<Readonly<{ widgetKey: string; source: "draft" | "published" }>, TWidgetPublicDeletionPlan>;
  "widget.deletion.commit": TOperation<Readonly<{ planToken: string; operationId: string }>, TWidgetPublicDeletionResult>;
  "widget.publication.publishMetadata": TOperation<Readonly<{ widgetKey: string; expectedManifestDigestSha256: string; expectedCatalogDigestSha256: string }>, TWidgetPublicMutationResult>;
  "widget.publication.buildAndPublish": TOperation<Readonly<{ widgetKey: string; expectedManifestDigestSha256: string; expectedCatalogDigestSha256: string }>, TWidgetPublicMutationResult>;
  "widget.placement.resolve": TOperation<Readonly<{ reference: Extract<TWidgetPlacementRef, { source: "published" }> }>, Readonly<{ kind: "published"; reference: Extract<TWidgetPlacementRef, { source: "published" }>; widgetKey: string; catalogGeneration: number; bounds: Readonly<{ width: number; height: number }> }>>;
  "widget.preview.open": TOperation<Readonly<{ canvasId: string; elementId: string; widgetKey: string }>, TWidgetTransportArtifact>;
  "widget.preview.rebuild": TOperation<Readonly<{ canvasId: string; elementId: string; widgetKey: string }>, TWidgetTransportArtifact>;
  "widget.preview.rebuildDraft": TOperation<Readonly<{ widgetKey: string }>, Readonly<{ widgetKey: string; acceptedGeneration: number; buildIdentity: string }>>;
  "widget.preview.load": TOperation<Readonly<{ canvasId: string; elementId: string; widgetKey: string }>, TWidgetTransportArtifact>;
  "widget.preview.close": TOperation<Readonly<{ canvasId: string; elementId: string }>, Readonly<{ closed: boolean }>>;
  "widget.preview.invoke": TOperation<Readonly<{ canvasId: string; elementId: string; functionName: string; input: unknown }>, TFunctionResult>;
  "widget.runtime.config": TOperation<Readonly<Record<string, never>> | undefined, TWidgetHostConfiguration>;
  "widget.runtime.load": TOperation<TWidgetHostSubject, TWidgetTransportArtifact>;
  "widget.runtime.state.get": TOperation<TWidgetStateIdentity, TWidgetStateResult>;
  "widget.runtime.state.change": TOperation<TWidgetStateIdentity & Readonly<{ expectedVersion: number; state: TWidgetSerializableJsonValue }>, TWidgetStateResult>;
}>;

export {
  PRIVATE_CURSOR_INPUT_KEYS,
  PRIVATE_IDEMPOTENCY_INPUT_KEYS,
  PRIVATE_REQUEST_PATHS,
  PRIVATE_STREAM_PATHS,
} from "./private-operation-manifest.generated";
import {
  PRIVATE_REQUEST_PATHS,
  PRIVATE_STREAM_PATHS,
} from "./private-operation-manifest.generated";
export type TPrivateRequestPath = typeof PRIVATE_REQUEST_PATHS[number];
export type TPrivateStreamPath = typeof PRIVATE_STREAM_PATHS[number];

export type TPrivateStreamOperations = Readonly<{
  "agent.events": TOperation<Readonly<{ afterSequence?: number }>, Readonly<{ sequence: number; [key: string]: unknown }>>;
  "canvas.events": TOperation<Readonly<{ canvasId: string; afterRevision: number }>, TCanvasEvent>;
  "db.events": TOperation<Readonly<{ canvasId: string; afterSequence?: number }>, Readonly<{
    sequence: number;
    data:
      | Readonly<{ change: "insert" | "update"; table: string; id: string; record: Readonly<Record<string, unknown>> }>
      | Readonly<{ change: "delete"; table: string; id: string }>;
  }>>;
  "notification.events": TOperation<Readonly<{ afterSequence?: number }>, TNotificationEvent & Readonly<{ sequence: number }>>;
  "widget.catalog.events": TOperation<Readonly<{ afterGeneration?: number }>, Readonly<{
    previousGeneration: number | null;
    generation: number;
    fullResync: boolean;
    changedWidgetKeys: readonly string[];
    previewWidgetKeys: readonly string[];
  }>>;
  "widget.runtime.state.events": TOperation<TWidgetStateIdentity & Readonly<{ afterVersion?: number }>, Readonly<{
    type: "changed" | "snapshot";
    reason?: "initial" | "resync";
    snapshot: TWidgetStateSnapshot;
  }>>;
}>;

type TAssert<T extends true> = T;
type TEqualKeys<Left, Right> = [Exclude<keyof Left, Right>, Exclude<Right, keyof Left>] extends [never, never]
  ? true
  : false;
type TRequestInventoryCoverage = TAssert<TEqualKeys<TPrivateRequestOperations, TPrivateRequestPath>>;
type TStreamInventoryCoverage = TAssert<TEqualKeys<TPrivateStreamOperations, TPrivateStreamPath>>;
void (0 as unknown as TRequestInventoryCoverage);
void (0 as unknown as TStreamInventoryCoverage);

export type TPrivateRequestInput<Path extends TPrivateRequestPath> = TPrivateRequestOperations[Path]["input"];
export type TPrivateRequestOutput<Path extends TPrivateRequestPath> = TPrivateRequestOperations[Path]["output"];
export type TPrivateStreamInput<Path extends TPrivateStreamPath> = TPrivateStreamOperations[Path]["input"];
export type TPrivateStreamOutput<Path extends TPrivateStreamPath> = TPrivateStreamOperations[Path]["output"];

export type TPrivateRequestOptions = Readonly<{ idempotencyKey?: string; signal?: AbortSignal }>;
export type TPrivateStreamOptions = Readonly<{ afterCursor?: number; signal?: AbortSignal }>;

export type TPrivateRequestArguments<Path extends TPrivateRequestPath> =
  undefined extends TPrivateRequestInput<Path>
    ? readonly [input?: TPrivateRequestInput<Path>, options?: TPrivateRequestOptions]
    : readonly [input: TPrivateRequestInput<Path>, options?: TPrivateRequestOptions];

export type TPrivateStreamArguments<Path extends TPrivateStreamPath> =
  {} extends TPrivateStreamInput<Path>
    ? readonly [input?: TPrivateStreamInput<Path>, options?: TPrivateStreamOptions]
    : readonly [input: TPrivateStreamInput<Path>, options?: TPrivateStreamOptions];

export const PrivateRequestPath = Schema.Literals(PRIVATE_REQUEST_PATHS);
export const PrivateStreamPath = Schema.Literals(PRIVATE_STREAM_PATHS);
export const PrivateWireValue = Schema.Json;
