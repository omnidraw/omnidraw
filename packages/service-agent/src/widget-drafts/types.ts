import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetPreviewService,
  IWidgetPublicationService,
  IWidgetRevisionSourceSnapshotReader,
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetManifestV3,
  TWidgetResourceBindingInput,
  TWidgetSourceSnapshot,
} from '@vibecanvas/widget-contract';

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

/** Structural subset implemented by AgentAuthoringStoreTurso and managed adapters. */
export interface IAgentAuthoringStore {
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
  & IWidgetPreviewService
  & IWidgetPublicationService
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
  publishedRevisionId: string | null;
  updatedAt: string;
  validation: TWidgetDraftValidation;
  previewAvailable: boolean;
  publishReady: boolean;
}>;

export type TWidgetPreviewReady = Readonly<{
  ready: true;
  draftId: string;
  definitionId: string;
  name: string;
  revision: string;
  manifest: TWidgetManifestV3;
  uiArtifact: Readonly<{
    digestSha256: string;
    byteSize: number;
    bytesBase64: string;
    runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  }>;
  contract: Readonly<{
    digestSha256: string;
    functions: readonly TWidgetBrowserFunctionDescriptor[];
    browserFunctionDescriptorsDigestSha256: string;
  }>;
  diagnostics: readonly string[];
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
