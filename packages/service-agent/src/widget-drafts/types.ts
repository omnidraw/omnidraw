import type { TTenantContext } from '@omnidraw/tenant-core';
import type {
  IWidgetDurablePreviewService,
  IWidgetPreviewPromotionService,
  IWidgetPreviewWorkspaceService,
  IWidgetPublicationService,
  IWidgetRevisionSourceSnapshotReader,
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV3,
  TWidgetDiagnostic,
  TWidgetPreviewMountLeaseAcquireRequest,
  TWidgetPreviewMountLeaseDescriptor,
  TWidgetPreviewMountLeaseReleaseRequest,
  TWidgetPreviewMountLeaseRenewRequest,
  TWidgetResourceBindingInput,
  TWidgetSourceSnapshot,
} from '@omnidraw/widget-contract';

export type TAgentAuthoringChatDescriptor = Readonly<{
  orgId: string;
  id: string;
  accountId: string;
  canvasId: string | null;
  externalSessionKey: string;
  name: string;
  status: 'active' | 'archived' | 'error';
  workspaceRelativePath: string;
  historyRelativePath: string;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TAgentAuthoringDraftStatus =
  | 'editing'
  | 'validating'
  | 'ready'
  | 'published'
  | 'error'
  | 'discarded';

export type TAgentAuthoringDraftDescriptor = Readonly<{
  orgId: string;
  id: string;
  chatId: string;
  definitionId: string;
  publishedRevisionId: string | null;
  name: string;
  status: TAgentAuthoringDraftStatus;
  sourceRelativePath: string;
  sourceDigestSha256: string | null;
  committedMutationId: string | null;
  buildSequence: number;
  lastError: Readonly<Record<string, unknown>> | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TAgentAuthoringDraftCasResult =
  | Readonly<{ status: 'updated'; draft: TAgentAuthoringDraftDescriptor }>
  | Readonly<{ status: 'conflict'; current: TAgentAuthoringDraftDescriptor | null }>;

export type TAgentAuthoringDraftPublicationSeed = Readonly<{
  definitionId: string;
  publishedRevisionId: string;
  sourceDigestSha256: string;
  committedMutationId: string;
}>;

export type TAgentAuthoringDraftCreate = Readonly<{
  id: string;
  chatId: string;
  name: string;
  sourceRelativePath: string;
  nowMs: number;
}> & (
  | Readonly<{ definitionId: string; publicationSeed?: undefined }>
  | Readonly<{ definitionId?: undefined; publicationSeed: TAgentAuthoringDraftPublicationSeed }>
);

export type TWidgetPreviewOwnerRole = 'companion' | 'placed';
export type TWidgetPreviewOwnerStatus =
  | 'queued'
  | 'building'
  | 'ready'
  | 'failed'
  | 'closed';

export type TWidgetPreviewRuntimeDiagnosticRecord = Readonly<{
  diagnostic: TWidgetDiagnostic;
  status: 'awaiting-retest';
  reportedAtMs: number;
}>;

export type TWidgetPreviewOwnerDescriptor = Readonly<{
  orgId: string;
  id: string;
  accountId: string;
  canvasId: string;
  frameNodeId: string;
  draftId: string;
  originChatId: string;
  role: TWidgetPreviewOwnerRole;
  status: TWidgetPreviewOwnerStatus;
  activeRevisionId: string | null;
  pendingBuildId: string | null;
  buildSequence: number;
  bindingRevision: number;
  bindingPlanDigestSha256: string | null;
  sourceDigestSha256: string | null;
  committedMutationId: string | null;
  runtimeDiagnostics: readonly TWidgetPreviewRuntimeDiagnosticRecord[];
  publishedPreviewRevisionId: string | null;
  publishedBindingRevision: number | null;
  publishedBindingPlanDigestSha256: string | null;
  publishedWidgetRevisionId: string | null;
  publishedIdempotencyKey: string | null;
  lastError: Readonly<Record<string, unknown>> | null;
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs: number | null;
}>;

export interface IWidgetPreviewOwnerStore {
  ensurePreviewOwner(tenant: TTenantContext, request: Readonly<{
    id: string;
    canvasId: string;
    frameNodeId: string;
    draftId: string;
    originChatId: string;
    role: TWidgetPreviewOwnerRole;
    nowMs: number;
  }>): Promise<TWidgetPreviewOwnerDescriptor>;
  getPreviewOwner(
    tenant: TTenantContext,
    previewId: string,
  ): Promise<TWidgetPreviewOwnerDescriptor | null>;
  listPreviewOwners(
    tenant: TTenantContext,
    request?: Readonly<{ draftId?: string; includeClosed?: boolean }>,
  ): Promise<readonly TWidgetPreviewOwnerDescriptor[]>;
  compareAndSetPreviewOwner(tenant: TTenantContext, request: Readonly<{
    previewId: string;
    expectedBuildSequence: number;
    expectedStatus?: Exclude<TWidgetPreviewOwnerStatus, 'closed'>;
    expectedPendingBuildId?: string | null;
    nextBuildSequence: number;
    status: Exclude<TWidgetPreviewOwnerStatus, 'closed'>;
    activeRevisionId?: string | null;
    pendingBuildId?: string | null;
    lastError?: Readonly<Record<string, unknown>> | null;
    expectedBindingRevision?: number;
    nextBindingRevision?: number;
    expectedBindingPlanDigestSha256?: string | null;
    nextBindingPlanDigestSha256?: string | null;
    expectedSourceDigestSha256?: string | null;
    nextSourceDigestSha256?: string | null;
    expectedCommittedMutationId?: string | null;
    nextCommittedMutationId?: string | null;
    runtimeDiagnostics?: readonly TWidgetPreviewRuntimeDiagnosticRecord[];
    nowMs: number;
  }>): Promise<TWidgetPreviewOwnerDescriptor | null>;
  closePreviewOwner(tenant: TTenantContext, request: Readonly<{
    previewId: string;
    frameNodeId: string;
    nowMs: number;
  }>): Promise<boolean>;
  acquirePreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseAcquireRequest,
  ): Promise<TWidgetPreviewMountLeaseDescriptor | null>;
  renewPreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseRenewRequest,
  ): Promise<TWidgetPreviewMountLeaseDescriptor | null>;
  releasePreviewMountLease(
    tenant: TTenantContext,
    request: TWidgetPreviewMountLeaseReleaseRequest,
  ): Promise<boolean>;
  hasConfirmedPreviewExecution(
    tenant: TTenantContext,
    request: Readonly<{
      draftId: string;
      draftRevisionSha256: string;
      nowMs: number;
    }>,
  ): Promise<boolean>;
  confirmedPreviewOwnerExecutionLeaseId(
    tenant: TTenantContext,
    request: Readonly<{
      previewId: string;
      previewRevisionId: string;
      draftRevisionSha256: string;
      committedMutationId: string;
      bindingRevision: number;
      mountLeaseId?: string;
      nowMs: number;
    }>,
  ): Promise<string | null>;
}

/** Structural subset implemented by AgentAuthoringStoreTurso and managed adapters. */
export interface IAgentAuthoringStore extends IWidgetPreviewOwnerStore {
  createChat(tenant: TTenantContext, request: Readonly<{
    id: string;
    canvasId: string | null;
    externalSessionKey: string;
    name: string;
    workspaceRelativePath: string;
    historyRelativePath: string;
    nowMs: number;
  }>): Promise<TAgentAuthoringChatDescriptor>;
  getChatByExternalSessionKey(
    tenant: TTenantContext,
    externalSessionKey: string,
  ): Promise<TAgentAuthoringChatDescriptor | null>;
  getChat(
    tenant: TTenantContext,
    chatId: string,
  ): Promise<TAgentAuthoringChatDescriptor | null>;
  createDraft(
    tenant: TTenantContext,
    request: TAgentAuthoringDraftCreate,
  ): Promise<TAgentAuthoringDraftDescriptor>;
  getDraft(tenant: TTenantContext, draftId: string): Promise<TAgentAuthoringDraftDescriptor | null>;
  getDraftByName(tenant: TTenantContext, name: string): Promise<TAgentAuthoringDraftDescriptor | null>;
  listDrafts(tenant: TTenantContext): Promise<readonly TAgentAuthoringDraftDescriptor[]>;
  compareAndSetDraft(tenant: TTenantContext, request: Readonly<{
    draftId: string;
    expectedSourceDigestSha256: string | null;
    nextSourceDigestSha256: string;
    expectedCommittedMutationId: string | null;
    nextCommittedMutationId: string;
    expectedBuildSequence: number;
    nextBuildSequence: number;
    nextStatus: TAgentAuthoringDraftStatus;
    nowMs: number;
    lastError?: Readonly<Record<string, unknown>> | null;
    publishedRevisionId?: string | null;
  }>): Promise<TAgentAuthoringDraftCasResult>;
  renameDraft(tenant: TTenantContext, request: Readonly<{
    draftId: string;
    expectedName: string;
    nextName: string;
    nextSourceRelativePath: string;
    expectedSourceDigestSha256: string | null;
    nextSourceDigestSha256: string;
    expectedCommittedMutationId: string | null;
    nextCommittedMutationId: string;
    expectedBuildSequence: number;
    nextBuildSequence: number;
    nowMs: number;
  }>): Promise<TAgentAuthoringDraftCasResult>;
  discardDraft(tenant: TTenantContext, request: Readonly<{
    draftId: string;
    expectedSourceDigestSha256: string | null;
    nowMs: number;
  }>): Promise<TAgentAuthoringDraftCasResult>;
}

export type TWidgetSourceCaptureCapability = Readonly<{
  captureSource(
    tenant: TTenantContext,
    sourceRoot: string,
    args?: Readonly<{
      captureId?: string;
      /** @deprecated Use captureId; this value never selects construction identity. */
      id?: string;
      createdAtMs?: number;
      expectedDigestSha256?: string;
    }>,
  ): Promise<TWidgetSourceSnapshot & Readonly<{ byteSize?: number }>>;
}>;

export type TWidgetBuildValidationCapability = Readonly<{
  validateBuild(
    tenant: TTenantContext,
    request: Readonly<{
      draftId?: string;
      snapshot: TWidgetSourceSnapshot;
      manifest: TWidgetManifestV3;
    }>,
  ): Promise<Readonly<{
    valid: boolean;
    diagnostics: readonly string[];
  }>>;
}>;

export type TWidgetAuthoringCapability = TWidgetSourceCaptureCapability
  & TWidgetBuildValidationCapability
  & IWidgetDurablePreviewService
  & IWidgetPreviewPromotionService
  & IWidgetPreviewWorkspaceService
  & Omit<IWidgetPublicationService, 'publishConstruction'>
  & IWidgetRevisionSourceSnapshotReader;

export type TWidgetResourceBindingResolver = (
  tenant: TTenantContext,
  request: Readonly<{
    draft: TAgentAuthoringDraftDescriptor;
    manifest: TWidgetManifestV3;
    /** Undefined means no durable selection record; an empty list is an explicit clear. */
    selectedResources?: readonly TWidgetAuthoringResourceSelection[];
  }>,
) => Promise<readonly TWidgetResourceBindingInput[]>;

export type TWidgetAuthoringResourceSelection = Readonly<{
  id: string;
  kind: 'kv' | 'secretStore' | 'db';
  name: string;
  status: 'created' | 'provisioning' | 'ready' | 'migrating' | 'error' | 'deleting';
}>;

export type TWidgetDraftValidation = Readonly<{
  status: 'unknown' | 'valid' | 'invalid';
  errors: readonly string[];
  warnings: readonly string[];
  validatedRevision?: string;
}>;

export type TWidgetDraftSummary = Readonly<{
  draftId: string;
  definitionId: string;
  chatId: string;
  name: string;
  displayName: string;
  state: 'new' | 'modified' | 'published';
  revision: string;
  committedMutationId: string | null;
  buildSequence: number;
  publishedRevisionId: string | null;
  updatedAt: string;
  validation: TWidgetDraftValidation;
  previewAvailable: boolean;
  publishReady: boolean;
}>;

export type TWidgetPreviewInteractionCheck =
  | Readonly<{ type: 'fill'; label: string; value: string }>
  | Readonly<{ type: 'click'; name: string }>
  | Readonly<{ type: 'assert-text'; text: string }>
  | Readonly<{ type: 'assert-status'; text: string }>
  | Readonly<{ type: 'wait-for-text'; text: string; timeoutMs?: number }>;

export type TWidgetPreviewInteractionResult = Readonly<{
  index: number;
  type: TWidgetPreviewInteractionCheck['type'];
  passed: boolean;
  evidence: string;
}>;

export type TWidgetPreviewTestResult = Readonly<{
  outcome: 'passed' | 'failed' | 'closed' | 'superseded' | 'timeout' | 'canceled';
  draftId: string;
  previewId: string;
  previewRevisionId: string;
  revision: string;
  committedMutationId: string;
  checks: readonly TWidgetPreviewInteractionResult[];
}>;

export type TWidgetPreviewAgentStatus = Readonly<{
  state: 'unavailable' | 'pending' | 'mounting' | 'ready' | 'failed' | 'closed';
  draftId: string | null;
  previewId: string | null;
  canvasId: string | null;
  frameNodeId: string | null;
  attemptedRevision: string | null;
  attemptedCommittedMutationId: string | null;
  attemptedPreviewRevisionId: string | null;
  displayedPreviewRevisionId: string | null;
  displayedDraftRevision: string | null;
  bindingRevision: number | null;
  buildSequence: number | null;
  ownerBuildSequence: number | null;
  diagnostics: readonly Readonly<{
    code: string;
    message: string;
    fingerprint?: string;
  }>[];
  message: string;
}>;

export type TWidgetPreviewWaitResult = Readonly<{
  outcome: 'ready' | 'failed' | 'superseded' | 'closed' | 'timeout' | 'unavailable' | 'canceled';
  status: TWidgetPreviewAgentStatus;
}>;

export type TWidgetPreviewReady = Readonly<{
  ready: true;
  draftId: string;
  definitionId: string;
  previewId: string | null;
  previewRevisionId: string | null;
  buildSequence: number | null;
  bindingRevision: number | null;
  bindingPlanDigestSha256: string | null;
  name: string;
  revision: string;
  committedMutationId: string;
  manifest: TWidgetManifestV3;
  uiArtifact: Readonly<{
    digestSha256: string;
    byteSize: number;
    bytesBase64: string;
    runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  }>;
  sourceMapArtifact: Readonly<{
    digestSha256: string;
    byteSize: number;
    bytesBase64: string;
  }> | null;
  contract: Readonly<{
    digestSha256: string;
    functions: readonly TWidgetBrowserFunctionDescriptor[];
    browserFunctionDescriptorsDigestSha256: string;
  }>;
  diagnostics: readonly TWidgetDiagnostic[];
}>;

export type TWidgetPreviewFailureReason =
  | 'not-found'
  | 'validation-failed'
  | 'manifest-invalid'
  | 'artifact-unavailable'
  | 'build-failed';

export type TWidgetPreviewResult = TWidgetPreviewReady | Readonly<{
  ready: false;
  draftId: string;
  revision?: string;
  reason: TWidgetPreviewFailureReason;
  message: string;
  diagnostics: readonly string[];
}>;

export type TWidgetPreviewCatalogState =
  | Readonly<{ status: 'ready'; revision: string }>
  | Readonly<{ status: 'failed'; revision: string; message: string }>
  | Readonly<{ status: 'not-ready'; revision: string; message: string | null }>;

export type TWidgetPreviewPublishSelection = Readonly<{
  idempotencyKey: string;
  previewId: string;
  previewRevisionId: string;
  canvasId: string;
  frameNodeId: string;
  expectedBindingRevision: number;
  expectedBindingPlanDigestSha256: string;
}>;

export type TWidgetPreviewDiagnosticReportResult = Readonly<{
  accepted: true;
  deduplicated: boolean;
}>;

export type TWidgetPublishResult =
  | Readonly<{
      published: true;
      draftId: string;
      definitionId: string;
      revision: string;
      publishedRevisionId: string;
      manifest: TWidgetManifestV3;
      uiRuntime: TWidgetCapsuleRuntimeDescriptor;
    }>
  | Readonly<{
      published: false;
      draftId: string;
      reason:
        | 'not-found'
        | 'stale-revision'
        | 'validation-failed'
        | 'resource-binding-invalid'
        | 'publication-conflict'
        | 'publication-failed';
      message: string;
      currentRevision?: string;
      errors: readonly string[];
      warnings: readonly string[];
    }>;
