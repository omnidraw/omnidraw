/**
 * @file Browser-safe widget manifest, immutable artifact, publication, and retention types.
 */
import type { TWidgetExecutableManifestProjection } from './filesystem/typed';

import type {
  TResourceRequirement,
} from '#backend/core/resources';
import type { WIDGET_CAPSULE_API_GROUPS } from './CONSTANTS';

export type TWidgetSourceSnapshotId = string;
export type TWidgetArtifactDigest = string;

export type TWidgetFrameBounds = Readonly<{
  width: number;
  height: number;
}>;

/** One immutable in-memory catalog observation; never a durable release ID. */
export type TWidgetPlacementRef =
  | Readonly<{
      source: 'published';
      widgetKey: string;
      catalogGeneration: number;
    }>
  | Readonly<{
      source: 'draft';
      widgetKey: string;
      catalogGeneration: number;
    }>;

export type TLucidStaticIconKey = string;

export type TOmnidrawToolIcon = Readonly<{
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

/** Capsule content addresses include their digest algorithm domain. */
export type TWidgetCapsuleHash = `sha256:${string}`;

/** Public Capsule API groups available to widget authors. */
export type TWidgetCapsuleApiGroup =
  (typeof WIDGET_CAPSULE_API_GROUPS)[number];

export type TWidgetCapsuleApiContract = Readonly<{
  format: 'capsule-api-groups-v1';
  groups: readonly TWidgetCapsuleApiGroup[];
  bundleDigest: TWidgetCapsuleHash;
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
  allowedApis: readonly TWidgetCapsuleApiGroup[];
  limits: TWidgetCapsuleBudgetRequest;
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
  format: 'omnidraw.widget-theme.v1';
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
  apis: readonly TWidgetCapsuleApiGroup[];
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

export type TWidgetSourceFile = Readonly<{
  path: string;
  bytes: Uint8Array;
}>;

/**
 * One immutable, content-addressed input used for every artifact in a build.
 * The source digest is its only identity; capture time is diagnostic metadata.
 */
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
  format: 'omnidraw.capsule-runtime.v2';
  capsuleArtifactHash: TWidgetCapsuleHash;
  apiContract: TWidgetCapsuleApiContract;
  budgets: TWidgetCapsuleBudgetRequest;
  capabilityRequests: readonly TWidgetCapsuleCapabilityRequest[];
  channels: TWidgetCapsuleChannelContract | null;
  parkability: TWidgetCapsuleParkability;
  signatureKeyIds: readonly string[];
}>;
export type TWidgetNativeCapsuleRuntimeDescriptor = TWidgetCapsuleRuntimeDescriptor;

export type TWidgetBuildRequest = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetExecutableManifestProjection;
  canonicalManifestJson: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  /** Trusted draft-private workspace identity. Never accepted from a public client. */
  workspaceKey?: string;
  /** Latest-wins cancellation propagated to application-owned guest processes. */
  signal?: AbortSignal;
  reportProgress?: (phase: 'installing' | 'building' | 'validating') => void;
  /** Trusted orchestration choice; never accepted from guest source or a public API payload. */
  signingPurpose: TWidgetCapsuleArtifactSigningPurpose;
}>;

/** Immutable inputs for artifact construction before any signing authority is selected. */
export type TWidgetArtifactConstructionRequest = Omit<
  TWidgetBuildRequest,
  'signingPurpose'
>;

/** Exact signed Capsule bytes plus independently verified runtime metadata. */
export type TWidgetCapsuleUiArtifact = Readonly<{
  kind: 'ui';
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
  capsuleArtifactHash: TWidgetCapsuleHash;
  runtimeDescriptor: TWidgetNativeCapsuleRuntimeDescriptor;
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
  expectedApis: readonly TWidgetCapsuleApiGroup[];
}>;

export type TWidgetCapsuleArtifactInspectionResult = Readonly<{
  digestSha256: TWidgetArtifactDigest;
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
}>;

export type TWidgetCapsuleRuntimeDescriptorCreateRequest = Readonly<{
  capsuleArtifactHash: TWidgetCapsuleHash;
  apiContract: TWidgetCapsuleApiContract;
  budgets: TWidgetCapsuleBudgetRequest;
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

/** Trusted generated-to-authored mapping bytes; never included in a guest artifact. */
export type TWidgetSourceMapArtifact = Readonly<{
  kind: 'source_map';
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

/** Application-owned distribution identity retained with an exact construction. */
export type TWidgetDistributionBuildProvenance = Readonly<{
  kind: 'external-distribution';
  producer: Readonly<{
    name: string;
    version: string;
    digest: TWidgetCapsuleHash;
  }>;
  sourceRevision: string;
  dependencyLockDigest: TWidgetCapsuleHash;
  buildConfigurationDigest: TWidgetCapsuleHash;
}>;

/** Runtime metadata that is stable before Preview or release keys are selected. */
export type TWidgetUnsignedCapsuleRuntimeDescriptor = Omit<
  TWidgetNativeCapsuleRuntimeDescriptor,
  'signatureKeyIds'
>;

/** Canonical unsigned Capsule output retained for exact Preview promotion. */
export type TWidgetUnsignedCapsuleUiArtifact = Readonly<{
  kind: 'unsigned-ui';
  digestSha256: TWidgetArtifactDigest;
  unsignedBytes: Uint8Array;
  capsuleArtifactHash: TWidgetCapsuleHash;
  runtimeDescriptor: TWidgetUnsignedCapsuleRuntimeDescriptor;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
}>;

/** Stable, signature-independent payload bound to one exact guest construction. */
export type TWidgetConstructionContractPayloadInput = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  sourceArtifactDigestSha256: TWidgetArtifactDigest;
  sourceMapArtifactDigestSha256: TWidgetArtifactDigest | null;
  canonicalManifestJson: string;
  unsignedUiDigestSha256: TWidgetArtifactDigest;
  capsuleArtifactHash: TWidgetCapsuleHash;
  apiContract: TWidgetCapsuleApiContract;
  budgets: TWidgetCapsuleBudgetRequest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  serverDigestSha256: TWidgetArtifactDigest | null;
  serverRuntimeAbi: string | null;
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  distributionProvenance: TWidgetDistributionBuildProvenance;
}>;

/**
 * One immutable guest construction. Preview and release signing derive from this
 * result without executing distribution, server, or Capsule builds again.
 */
export type TWidgetArtifactConstructionResult = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  sourceArtifact: TWidgetSourceArtifact;
  sourceMapArtifact: TWidgetSourceMapArtifact | null;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  canonicalManifestJson: string;
  distributionProvenance: TWidgetDistributionBuildProvenance;
  /** Exact closed browser distribution, with paths relative to dist/. */
  distributionFiles?: readonly TWidgetSourceFile[];
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  constructionContractDigestSha256: TWidgetArtifactDigest;
  uiArtifact: TWidgetUnsignedCapsuleUiArtifact;
  serverArtifact: TWidgetServerBuildArtifact | null;
  diagnostics: readonly TWidgetBuildDiagnostic[];
}>;

export type TWidgetArtifactConstructionSignRequest = Readonly<{
  construction: TWidgetArtifactConstructionResult;
  /** Trusted orchestration choice; never accepted from guest source or a public API payload. */
  signingPurpose: TWidgetCapsuleArtifactSigningPurpose;
}>;

export type TWidgetBuildResult = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetCapsuleBuildIdentity;
  buildPolicyId: string;
  canonicalManifestJson: string;
  constructionContractDigestSha256: TWidgetArtifactDigest;
  distributionProvenance: TWidgetDistributionBuildProvenance;
  /** Exact closed browser distribution, with paths relative to dist/. */
  distributionFiles?: readonly TWidgetSourceFile[];
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  contractDigestSha256: TWidgetArtifactDigest;
  uiArtifact: TWidgetCapsuleUiArtifact;
  sourceMapArtifact: TWidgetSourceMapArtifact | null;
  serverArtifact: TWidgetServerBuildArtifact | null;
  diagnostics: readonly TWidgetBuildDiagnostic[];
}>;

type TWidgetContractPayloadBase = Readonly<{
  canonicalManifestJson: string;
  uiDigestSha256: TWidgetArtifactDigest;
  capsuleArtifactHash: TWidgetCapsuleHash;
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

/** Canonical inputs whose encoding binds one build to its exact outputs. */
export type TWidgetContractPayloadInput = TWidgetContractPayloadBase & Readonly<{
  apiContract: TWidgetCapsuleApiContract;
  budgets: TWidgetCapsuleBudgetRequest;
}>;

export type TWidgetServerFunctionDescriptorExtractionRequest = Readonly<{
  serverArtifact: TWidgetServerBuildArtifact;
  serverEntry: string;
  runtimeAbi: string;
}>;
