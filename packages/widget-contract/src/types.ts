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
  | Readonly<{ source: 'draft'; name: string; revision: string }>;

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
export type TWidgetDefinitionStatus = 'draft' | 'published' | 'archived';
export type TWidgetArtifactRetentionState = 'pinned' | 'eligible' | 'deleting';
export type TWidgetArtifactReadPurpose =
  | 'browser_ui'
  | 'server_execution'
  | 'source_build'
  | 'source_map'
  | 'cell_move';

/** Capsule content addresses include their digest algorithm domain. */
export type TWidgetCapsuleHash = `sha256:${string}`;

/** Normalized Capsule execution target selected by trusted build policy. */
export type TWidgetCapsuleTarget = Readonly<{
  runtimeAbi: string;
  domProfile: string;
  featureProfiles: readonly string[];
}>;

/** Complete Capsule resource ceiling. Zero is a valid explicit denial. */
export type TWidgetCapsuleBudgets = Readonly<{
  cpuMs: number;
  memoryBytes: number;
  domNodes: number;
  handles: number;
  messageBytes: number;
  streamBytes: number;
  assetBytes: number;
  networkBytes: number;
  gpuBytes: number;
  lifecycleBytes: number;
}>;

export type TWidgetCapsuleBudgetRequest = Readonly<Partial<TWidgetCapsuleBudgets>>;

/** Browser-safe deployment target shared by trusted build and host policy. */
export type TWidgetCapsuleHostTargetBase = Readonly<
  Pick<TWidgetCapsuleTarget, 'runtimeAbi' | 'domProfile'>
>;

/** Public verification material; private Capsule signing keys never cross this boundary. */
export type TWidgetCapsulePublicSigningKey = Readonly<{
  keyId: string;
  algorithm: 'Ed25519';
  format: 'raw';
  publicKeyBase64: string;
}>;

/** Public, cacheable policy required to construct a Capsule browser host. */
export type TWidgetCapsuleHostConfiguration = Readonly<{
  generation: string;
  targetBase: TWidgetCapsuleHostTargetBase;
  allowedFeatureProfiles: readonly string[];
  budgetCeiling: TWidgetCapsuleBudgets;
  budgetDefaults: TWidgetCapsuleBudgets;
  previewSigningKeyId: string;
  releaseSigningKeyId: string;
  signingKeys: readonly TWidgetCapsulePublicSigningKey[];
}>;

export type TWidgetCapsuleSchemaReference = Readonly<{
  format: 'capsule-schema-v1';
  hash: TWidgetCapsuleHash;
}>;

/**
 * Host-owned widget props are JSON-only canvas data. Capsule applies the
 * concrete depth, item, key, string, and wire-size ceilings at the channel
 * boundary.
 */
export type TWidgetCapsuleProps = TWidgetSerializableJsonObject;

/** Minimal semantic theme projection exposed to untrusted widget code. */
export type TWidgetCapsuleTheme = Readonly<{
  format: 'vibecanvas.widget-theme.v1';
  appearance: 'light' | 'dark';
  tokens: Readonly<{
    background: string;
    foreground: string;
    surface: string;
    surfaceForeground: string;
    muted: string;
    mutedForeground: string;
    primary: string;
    primaryForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    success: string;
    border: string;
  }>;
}>;

/**
 * The only first-release guest output action. The guest selects neither a
 * service nor an application identity, URL, title, or durable destination.
 */
export type TWidgetCapsuleNotificationOutput = Readonly<{
  type: 'notification';
  tone: 'info' | 'success' | 'error';
  message: string;
}>;

/** Untrusted authority request embedded in a Capsule artifact; it grants nothing. */
export type TWidgetCapsuleCapabilityRequest = Readonly<{
  id: string;
  versionRange: string;
  contractHash: TWidgetCapsuleHash;
  required: boolean;
  operations: readonly string[];
}>;

/** Signed Capsule guest-channel declaration. */
export type TWidgetCapsuleChannelContract = Readonly<{
  format: 'capsule-guest-channels-v1';
  lifecycle?: true;
  props?: TWidgetCapsuleSchemaReference;
  theme?: TWidgetCapsuleSchemaReference;
  output?: TWidgetCapsuleSchemaReference;
  store?: Readonly<{
    schema: TWidgetCapsuleSchemaReference;
    maxEntries: number;
  }>;
}>;

/** Parking is deliberately disabled for the first Capsule release. */
export type TWidgetCapsuleParkability = Readonly<{
  parkable: false;
}>;

export type TWidgetUiManifest = Readonly<{
  runtime: 'capsule';
  entry: string;
  target: TWidgetCapsuleTarget;
  budgets?: TWidgetCapsuleBudgetRequest;
  state?: Readonly<{
    collaborative: boolean;
    localStore: 'none' | 'ephemeral';
  }>;
  parkability?: Readonly<{
    enabled: false;
  }>;
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

/** Fields outside the current manifest contract are rejected by the runtime schema. */
export type TWidgetManifestV3 = Readonly<{
  schemaVersion: 3;
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

/** Exact pinned Capsule package/build identity used by trusted tooling. */
export type TWidgetCapsuleBuildIdentity = Readonly<{
  packageName: '@omnidraw/capsule';
  packageVersion: string;
  packageDigest: TWidgetCapsuleHash;
  buildApiVersion: string;
  runtimeBuildDigest: TWidgetCapsuleHash;
}>;

/** Trusted, serializable metadata inspected from exact signed Capsule bytes. */
export type TWidgetCapsuleRuntimeDescriptor = Readonly<{
  format: 'vibecanvas.capsule-runtime.v1';
  capsuleArtifactHash: TWidgetCapsuleHash;
  target: TWidgetCapsuleTarget;
  budgets: TWidgetCapsuleBudgets;
  capabilityRequests: readonly TWidgetCapsuleCapabilityRequest[];
  channels: TWidgetCapsuleChannelContract | null;
  parkability: TWidgetCapsuleParkability;
  signatureKeyIds: readonly string[];
}>;

export type TWidgetBuildRequest = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV3;
  canonicalManifestJson: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  /** Trusted orchestration choice; never accepted from guest source or a public API payload. */
  signingPurpose: TWidgetCapsuleArtifactSigningPurpose;
}>;

/** Exact signed Capsule bytes plus independently verified runtime metadata. */
export type TWidgetCapsuleUiArtifact = Readonly<{
  kind: 'ui';
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
  capsuleArtifactHash: TWidgetCapsuleHash;
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  requestedBudgets: TWidgetCapsuleBudgetRequest;
  effectiveBudgets: TWidgetCapsuleBudgets;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
}>;

export type TWidgetCapsuleUiBuildRequest = TWidgetBuildRequest & Readonly<{
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
}>;

export type TWidgetCapsuleArtifactSigningPurpose = 'preview' | 'release';

export type TWidgetCapsuleArtifactSignRequest = Readonly<{
  unsignedBytes: Uint8Array;
  capsuleArtifactHash: TWidgetCapsuleHash;
  purpose: TWidgetCapsuleArtifactSigningPurpose;
}>;

export type TWidgetCapsuleArtifactSignResult = Readonly<{
  signedBytes: Uint8Array;
  signatureKeyIds: readonly string[];
}>;

export type TWidgetCapsuleArtifactInspectionRequest = Readonly<{
  signedBytes: Uint8Array;
  expectedTarget: TWidgetCapsuleTarget;
}>;

export type TWidgetCapsuleArtifactInspectionResult = Readonly<{
  digestSha256: TWidgetArtifactDigest;
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
}>;

export type TWidgetCapsuleRuntimeDescriptorCreateRequest = Readonly<{
  capsuleArtifactHash: TWidgetCapsuleHash;
  target: TWidgetCapsuleTarget;
  budgets: TWidgetCapsuleBudgets;
  capabilityRequests: readonly TWidgetCapsuleCapabilityRequest[];
  channels: TWidgetCapsuleChannelContract | null;
  signatureKeyIds: readonly string[];
}>;

/** Server artifacts retain their distinct server execution ABI. */
export type TWidgetServerBuildArtifact = Readonly<{
  kind: 'server';
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
  runtimeAbi: string;
}>;

/** Canonically encoded immutable source bytes stored beside a built revision. */
export type TWidgetSourceArtifact = Readonly<{
  kind: 'source';
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
}>;

export type TWidgetBuildDiagnostic = Readonly<{
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path?: string;
  line?: number;
  column?: number;
}>;

export type TWidgetBuildResult = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  canonicalManifestJson: string;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  uiArtifact: TWidgetCapsuleUiArtifact;
  serverArtifact: TWidgetServerBuildArtifact | null;
  diagnostics: readonly TWidgetBuildDiagnostic[];
}>;

/** Persisted inputs whose canonical encoding binds a revision to its artifacts. */
export type TWidgetContractPayloadInput = Readonly<{
  canonicalManifestJson: string;
  uiDigestSha256: TWidgetArtifactDigest;
  capsuleArtifactHash: TWidgetCapsuleHash;
  target: TWidgetCapsuleTarget;
  budgets: TWidgetCapsuleBudgets;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  signatureKeyIds: readonly string[];
  serverDigestSha256: TWidgetArtifactDigest | null;
  serverRuntimeAbi: string | null;
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
}>;

export type TWidgetServerFunctionDescriptorExtractionRequest = Readonly<{
  serverArtifact: TWidgetServerBuildArtifact;
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
  manifest: TWidgetManifestV3;
  canonicalManifestJson: string;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  uiArtifact: TWidgetArtifactDescriptor;
  uiRuntime: TWidgetCapsuleRuntimeDescriptor;
  serverArtifact: TWidgetArtifactDescriptor | null;
  serverRuntimeAbi: string | null;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
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

/** Stateless UI-only build of the current editable draft snapshot. */
export type TWidgetPreviewBuildRequest = Readonly<{
  draftId: string;
  definitionId: TWidgetDefinitionId;
  draftRevisionSha256: TWidgetArtifactDigest;
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetManifestV3;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
}>;

export type TWidgetPreviewBuildResult = Readonly<{
  draftId: string;
  definitionId: TWidgetDefinitionId;
  draftRevisionSha256: TWidgetArtifactDigest;
  manifest: TWidgetManifestV3;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  uiArtifact: TWidgetCapsuleUiArtifact;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  diagnostics: readonly TWidgetBuildDiagnostic[];
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
  manifest: TWidgetManifestV3;
  bindings: readonly TWidgetResourceBindingInput[];
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  nowMs: number;
}>;

export type TWidgetPublishResult = TWidgetPublicationCommitResult;
