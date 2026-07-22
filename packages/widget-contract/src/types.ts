/**
 * @file Browser-safe widget manifest, immutable artifact, publication, and retention types.
 */

import type {
  TResourceBindingReference,
  TResourceId,
  TResourceKind,
  TResourceRequirement,
} from '@vibecanvas/resource-runtime';
import type { TOrganizationId } from '@vibecanvas/tenant-core';

export type TWidgetDefinitionId = string;
export type TWidgetRevisionId = string;
export type TWidgetPreviewId = string;
export type TWidgetPreviewRevisionId = string;
export type TWidgetArtifactId = string;
export type TWidgetSourceSnapshotId = string;
export type TWidgetArtifactDigest = string;
export type TWidgetArtifactReadCapability = string;

export type TWidgetFrameBounds = Readonly<{
  width: number;
  height: number;
}>;

export type TWidgetPlacementRef =
  | Readonly<{ source: 'published'; name: string; revision: string }>
  | Readonly<{ source: 'draft'; name: string; revision: string }>
  | Readonly<{ source: 'preview'; name: string; revision: string }>;

export type TLucidStaticIconKey = string;

export type TVibecanvasToolIcon = Readonly<{
  lucidIcon?: TLucidStaticIconKey;
  svgIcon?: string;
}>;

export type TWidgetSerializableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly TWidgetSerializableJsonValue[]
  | TWidgetSerializableJsonObject;
export type TWidgetSerializableJsonObject = Readonly<{
  [key: string]: TWidgetSerializableJsonValue;
}>;

export type TWidgetArtifactKind = 'ui' | 'server' | 'source' | 'source_map';
export type TWidgetBuildArtifactKind = Extract<TWidgetArtifactKind, 'ui' | 'server'>;
export type TWidgetDefinitionStatus = 'draft' | 'published' | 'archived';
export type TWidgetArtifactRetentionState = 'pinned' | 'eligible' | 'deleting';
export type TWidgetArtifactReadPurpose =
  | 'browser_ui'
  | 'server_execution'
  | 'preview_ui'
  | 'preview_server'
  | 'source_build'
  | 'source_map'
  | 'cell_move';

export type TWidgetUiManifest = Readonly<{
  entry: string;
}>;

export type TWidgetServerManifest = Readonly<{
  entry: string;
  runtimeAbi: string;
}>;

/** Short-lived server-function effect ceiling emitted by the trusted build. */
export type TWidgetServerFunctionEffect = 'fn' | 'fx' | 'tx';

export type TWidgetServerFunctionResourceAccess = Readonly<{
  slot: string;
  effect: 'read' | 'write' | 'read_write';
}>;

export type TWidgetServerFunctionLimits = Readonly<{
  timeoutMs: number;
  memoryTier: 'small' | 'medium' | 'large';
  outputByteLimit: number;
  logByteLimit: number;
}>;

export type TWidgetServerFunctionRetry = Readonly<{
  mode: 'none' | 'idempotent';
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}>;

/**
 * Canonical, serializable registration emitted for one direct named export.
 * Host-owned identity, revision, artifact digest, and runtime ABI are bound by
 * the publication/store record rather than trusted from guest code.
 */
export type TWidgetServerFunctionDescriptor = Readonly<{
  schemaVersion: 1;
  exportName: string;
  /** Host-derived source module containing the direct export. */
  modulePath?: string;
  effect: TWidgetServerFunctionEffect;
  inputSchema: TWidgetSerializableJsonObject;
  outputSchema: TWidgetSerializableJsonObject;
  resources: readonly TWidgetServerFunctionResourceAccess[];
  limits: TWidgetServerFunctionLimits;
  retry: TWidgetServerFunctionRetry;
}>;

/** Browser-visible function metadata; host filesystem module paths are never exposed. */
export type TWidgetBrowserFunctionDescriptor = Omit<TWidgetServerFunctionDescriptor, 'modulePath'>;

export type TWidgetServerFunctionDescriptorValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | 'browser_only_has_functions'
        | 'server_has_no_functions'
        | 'missing_module_path'
        | 'duplicate_export'
        | 'duplicate_resource_slot'
        | 'fn_has_resources'
        | 'fx_has_write_resource'
        | 'unknown_resource_slot'
        | 'resource_effect_exceeded';
      exportName?: string;
      slot?: string;
    }>;

/** Actor/v1 fields are intentionally absent and rejected by the runtime schema. */
export type TWidgetManifestV2 = Readonly<{
  schemaVersion: 2;
  name: string;
  slug: string;
  description?: string;
  ui: TWidgetUiManifest;
  server?: TWidgetServerManifest;
  resources?: readonly TResourceRequirement[];
}>;

export type TWidgetSourceFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

/** One immutable, content-addressed input used for every artifact in a build. */
export type TWidgetSourceSnapshot = Readonly<{
  id: TWidgetSourceSnapshotId;
  digestSha256: TWidgetArtifactDigest;
  files: readonly TWidgetSourceFile[];
  createdAtMs: number;
}>;

export type TWidgetBuildRequest = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV2;
  canonicalManifestJson: string;
  builderIdentity: string;
}>;

export type TWidgetBuildArtifact = Readonly<{
  kind: TWidgetBuildArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
}>;

/** Canonically encoded immutable source bytes stored beside a built revision. */
export type TWidgetSourceArtifact = Readonly<{
  kind: 'source';
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
}>;

export type TWidgetBuildResult = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  canonicalManifestJson: string;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  uiArtifact: TWidgetBuildArtifact;
  serverArtifact: TWidgetBuildArtifact | null;
}>;

/** Persisted inputs whose canonical encoding binds a revision to its artifacts. */
export type TWidgetContractPayloadInput = Readonly<{
  canonicalManifestJson: string;
  uiDigestSha256: TWidgetArtifactDigest;
  serverDigestSha256: TWidgetArtifactDigest | null;
  runtimeAbi: string | null;
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
}>;

export type TWidgetServerFunctionDescriptorExtractionRequest = Readonly<{
  serverArtifact: TWidgetBuildArtifact;
  serverEntry: string;
  runtimeAbi: string;
}>;

export type TWidgetArtifactDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetArtifactId;
  kind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  byteSize: number;
  retentionState: TWidgetArtifactRetentionState;
  retainUntilMs: number | null;
  createdAtMs: number;
}>;

export type TWidgetArtifactPut = Readonly<{
  id: TWidgetArtifactId;
  kind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
  retentionState: TWidgetArtifactRetentionState;
  retainUntilMs: number | null;
  createdAtMs: number;
}>;

export type TWidgetArtifactDeleteRequest = Readonly<{
  artifactId: TWidgetArtifactId;
  kind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
}>;

export type TWidgetArtifactReadCapabilityClaims = Readonly<{
  orgId: TOrganizationId;
  definitionId: TWidgetDefinitionId;
  revisionId: TWidgetRevisionId;
  artifactId: TWidgetArtifactId;
  artifactKind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  purpose: TWidgetArtifactReadPurpose;
  audience: string;
  expiresAtMs: number;
  nonce: string;
}>;

export type TWidgetArtifactReadRequest = Readonly<{
  artifactId: TWidgetArtifactId;
  readCapability: TWidgetArtifactReadCapability;
  purpose: TWidgetArtifactReadPurpose;
}>;

export type TWidgetArtifactReadCapabilityIssueRequest = Omit<
  TWidgetArtifactReadCapabilityClaims,
  'orgId' | 'purpose' | 'audience' | 'nonce'
>;

/** Internal signing input; callers of the public service never choose a nonce. */
export type TWidgetArtifactReadCapabilitySignRequest = Omit<
  TWidgetArtifactReadCapabilityClaims,
  'orgId'
>;

export type TWidgetArtifactReadCapabilityVerifyRequest = Readonly<{
  readCapability: TWidgetArtifactReadCapability;
  purpose: TWidgetArtifactReadPurpose;
  audience: string;
  nowMs: number;
}>;

export type TWidgetDefinitionDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetDefinitionId;
  slug: string;
  name: string;
  status: TWidgetDefinitionStatus;
  activeRevisionId: TWidgetRevisionId | null;
  createdAtMs: number;
  updatedAtMs: number;
}>;

export type TWidgetDefinitionCreate = Readonly<{
  id: TWidgetDefinitionId;
  slug: string;
  name: string;
  nowMs: number;
}>;

export type TWidgetPublishedPlacementTarget = Readonly<{
  definitionId: TWidgetDefinitionId;
  revisionId: TWidgetRevisionId;
}>;

export type TWidgetPublishedPlacementDescriptor = Readonly<{
  definitionId: TWidgetDefinitionId;
  revisionId: TWidgetRevisionId;
  name: string;
  slug: string;
  description: string | null;
  contractDigestSha256: TWidgetArtifactDigest;
  updatedAtMs: number;
  bounds: Readonly<{ width: number; height: number }>;
}>;

export type TWidgetRevisionDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetRevisionId;
  definitionId: TWidgetDefinitionId;
  revisionNumber: number;
  manifest: TWidgetManifestV2;
  canonicalManifestJson: string;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  uiArtifact: TWidgetArtifactDescriptor;
  serverArtifact: TWidgetArtifactDescriptor | null;
  createdAtMs: number;
}>;

/** Authoritative source input retained for rebuild, edit, and provenance checks. */
export type TWidgetRevisionSourceDescriptor = Readonly<{
  orgId: TOrganizationId;
  definitionId: TWidgetDefinitionId;
  revisionId: TWidgetRevisionId;
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  sourceArtifact: TWidgetArtifactDescriptor;
  builderIdentity: string;
  createdAtMs: number;
}>;

export type TWidgetPublicationSourceCreate = Omit<
  TWidgetRevisionSourceDescriptor,
  'orgId' | 'definitionId' | 'revisionId'
>;

export type TWidgetRevisionCreate = Omit<TWidgetRevisionDescriptor, 'orgId'>;

/** Revision numbering is allocated inside the control-store publication transaction. */
export type TWidgetPublicationRevisionCreate = Omit<TWidgetRevisionCreate, 'revisionNumber'>;

/** Caller selects concrete resources; manifest ceilings are always host-derived. */
export type TWidgetResourceBindingInput = Readonly<{
  slot: string;
  resourceId: TResourceId;
  kind: TResourceKind;
  allowRead: boolean;
  allowWrite: boolean;
}>;

export type TWidgetResourceBindingDescriptor = Readonly<{
  orgId: TOrganizationId;
  binding: TResourceBindingReference;
}>;

export type TWidgetResourceBindingValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | 'duplicate_requirement_slot'
        | 'duplicate_binding_slot'
        | 'unknown_slot'
        | 'missing_required_slot'
        | 'kind_mismatch'
        | 'empty_permission'
        | 'permission_exceeded';
      slot: string;
    }>;

export type TWidgetPublicationCommitInput = Readonly<{
  expectedActiveRevisionId: TWidgetRevisionId | null;
  revision: TWidgetPublicationRevisionCreate;
  source: TWidgetPublicationSourceCreate;
  bindings: readonly TWidgetResourceBindingInput[];
  nowMs: number;
}>;

export type TWidgetPublicationCommitResult =
  | Readonly<{
      status: 'committed';
      definition: TWidgetDefinitionDescriptor;
      revision: TWidgetRevisionDescriptor;
      previousActiveRevisionId: TWidgetRevisionId | null;
    }>
  | Readonly<{
      status: 'conflict';
      currentActiveRevisionId: TWidgetRevisionId | null;
    }>;

/** CAS archive removes one publication from the active catalog without erasing provenance. */
export type TWidgetDefinitionArchiveInput = Readonly<{
  definitionId: TWidgetDefinitionId;
  expectedActiveRevisionId: TWidgetRevisionId;
  nowMs: number;
}>;

export type TWidgetDefinitionArchiveResult =
  | Readonly<{
      status: 'archived';
      definition: TWidgetDefinitionDescriptor;
      previousActiveRevisionId: TWidgetRevisionId;
    }>
  | Readonly<{
      status: 'conflict';
      currentActiveRevisionId: TWidgetRevisionId | null;
    }>;

export type TWidgetRevisionSourceSnapshotReadRequest = Readonly<{
  definitionId: TWidgetDefinitionId;
  revisionId: TWidgetRevisionId;
}>;

export type TWidgetRollbackInput = Readonly<{
  definitionId: TWidgetDefinitionId;
  expectedActiveRevisionId: TWidgetRevisionId;
  targetRevisionId: TWidgetRevisionId;
  nowMs: number;
}>;

export type TWidgetActiveRevisionCasResult =
  | Readonly<{
      status: 'updated';
      definition: TWidgetDefinitionDescriptor;
      previousActiveRevisionId: TWidgetRevisionId;
      activeRevisionId: TWidgetRevisionId;
    }>
  | Readonly<{
      status: 'conflict';
      currentActiveRevisionId: TWidgetRevisionId | null;
    }>;

export type TWidgetArtifactResolutionRequest = Readonly<{
  definitionId: TWidgetDefinitionId;
  revisionId: TWidgetRevisionId;
  artifactId: TWidgetArtifactId;
  kind: TWidgetArtifactKind;
  digestSha256: TWidgetArtifactDigest;
}>;

/** Privileged GC probe scoped by tenant; never an artifact read authority. */
export type TWidgetArtifactDigestReferenceRequest = Readonly<{
  digestSha256: TWidgetArtifactDigest;
}>;

export type TWidgetRevisionPruneRequest = Readonly<{
  nowMs: number;
  inactiveBeforeMs: number;
  limit: number;
}>;

export type TWidgetRevisionPruneResult = Readonly<{
  prunedRevisionIds: readonly TWidgetRevisionId[];
}>;

export type TWidgetArtifactRetentionReconcileRequest = Readonly<{
  nowMs: number;
  gracePeriodMs: number;
  limit: number;
}>;

export type TWidgetArtifactRetentionReconcileResult = Readonly<{
  pinnedArtifactIds: readonly TWidgetArtifactId[];
  eligibleArtifactIds: readonly TWidgetArtifactId[];
}>;

export type TWidgetArtifactGcCandidateRequest = Readonly<{
  nowMs: number;
  limit: number;
}>;

export type TWidgetArtifactDeletionClaimRequest = Readonly<{
  artifactId: TWidgetArtifactId;
  expectedDigestSha256: TWidgetArtifactDigest;
  expectedRetainUntilMs: number;
  nowMs: number;
}>;

export type TWidgetArtifactDeletionCompleteRequest = Readonly<{
  artifactId: TWidgetArtifactId;
  expectedDigestSha256: TWidgetArtifactDigest;
}>;

export type TWidgetArtifactDeletionCompleteResult = Readonly<{
  completed: boolean;
  /** True only when no remaining artifact reference owns this physical digest. */
  deleteBlob: boolean;
}>;

export type TWidgetArtifactRetentionRestoreRequest = Readonly<{
  artifactId: TWidgetArtifactId;
  expectedDigestSha256: TWidgetArtifactDigest;
}>;

export type TWidgetPreviewArtifactKind = Extract<TWidgetArtifactKind, 'ui' | 'server'>;

/** One immutable preview revision. The active pointer may advance independently. */
export type TWidgetPreviewRevisionDescriptor = Readonly<{
  orgId: TOrganizationId;
  id: TWidgetPreviewRevisionId;
  previewId: TWidgetPreviewId;
  draftId: string;
  definitionId: TWidgetDefinitionId;
  draftRevisionSha256: TWidgetArtifactDigest;
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  sourceArtifact: TWidgetArtifactDescriptor;
  manifest: TWidgetManifestV2;
  canonicalManifestJson: string;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  uiArtifact: TWidgetArtifactDescriptor;
  serverArtifact: TWidgetArtifactDescriptor | null;
  createdAtMs: number;
  retainUntilMs: number;
  expiresAtMs: number;
}>;

export type TWidgetPreviewRevisionCreate = Omit<TWidgetPreviewRevisionDescriptor, 'orgId'>;

export type TWidgetPreviewCommitInput = Readonly<{
  expectedActiveRevisionId: TWidgetPreviewRevisionId | null;
  revision: TWidgetPreviewRevisionCreate;
  bindings: readonly TWidgetResourceBindingInput[];
  nowMs: number;
}>;

export type TWidgetPreviewCommitResult =
  | Readonly<{
      status: 'committed';
      revision: TWidgetPreviewRevisionDescriptor;
      previousActiveRevisionId: TWidgetPreviewRevisionId | null;
    }>
  | Readonly<{
      status: 'conflict';
      currentActiveRevisionId: TWidgetPreviewRevisionId | null;
    }>;

export type TWidgetPreviewGetRequest = Readonly<{
  previewId: TWidgetPreviewId;
  nowMs: number;
}>;

export type TWidgetPreviewRevisionGetRequest = TWidgetPreviewGetRequest & Readonly<{
  revisionId: TWidgetPreviewRevisionId;
}>;

export type TWidgetPreviewStopRequest = Readonly<{
  previewId: TWidgetPreviewId;
  expectedActiveRevisionId: TWidgetPreviewRevisionId;
  nowMs: number;
}>;

export type TWidgetPreviewArtifactResolutionRequest = Readonly<{
  previewId: TWidgetPreviewId;
  revisionId: TWidgetPreviewRevisionId;
  artifactId: TWidgetArtifactId;
  kind: TWidgetPreviewArtifactKind;
  digestSha256: TWidgetArtifactDigest;
  nowMs: number;
}>;

export type TWidgetPreviewArtifactReadCapabilityIssueRequest = Omit<
  TWidgetArtifactReadCapabilityIssueRequest,
  'definitionId' | 'revisionId' | 'artifactKind'
> & Readonly<{
  previewId: TWidgetPreviewId;
  previewRevisionId: TWidgetPreviewRevisionId;
  artifactKind: TWidgetPreviewArtifactKind;
}>;

export type TWidgetPreviewBuildRequest = Readonly<{
  previewId: TWidgetPreviewId;
  expectedActiveRevisionId: TWidgetPreviewRevisionId | null;
  revisionId: TWidgetPreviewRevisionId;
  draftId: string;
  definitionId: TWidgetDefinitionId;
  draftRevisionSha256: TWidgetArtifactDigest;
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV2;
  bindings: readonly TWidgetResourceBindingInput[];
  builderIdentity: string;
  nowMs: number;
  retainUntilMs: number;
  expiresAtMs: number;
}>;

export type TWidgetPreviewBuildResult = TWidgetPreviewCommitResult;

/**
 * Activates an existing preview through the same metadata fence as artifact GC.
 * The artifact digest is an integrity check, never read authority.
 */
export type TWidgetPreviewArtifactActivationRequest = Readonly<{
  previewId: string;
  artifactId: TWidgetArtifactId;
  expectedDigestSha256: TWidgetArtifactDigest;
  nowMs: number;
}>;

export type TWidgetArtifactGcRequest = Readonly<{
  nowMs: number;
  gracePeriodMs: number;
  limit: number;
}>;

export type TWidgetArtifactGcResult = Readonly<{
  reconciledPinned: number;
  reconciledEligible: number;
  deleted: number;
  restored: number;
}>;

export type TWidgetPublishRequest = Readonly<{
  definitionId: TWidgetDefinitionId;
  expectedActiveRevisionId: TWidgetRevisionId | null;
  revisionId: TWidgetRevisionId;
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV2;
  bindings: readonly TWidgetResourceBindingInput[];
  builderIdentity: string;
  nowMs: number;
}>;

export type TWidgetPublishResult = TWidgetPublicationCommitResult;
