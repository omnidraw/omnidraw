/**
 * @file Browser-safe widget manifest, immutable artifact, publication, and retention types.
 */
import type { TWidgetExecutableManifestProjection } from './filesystem/typed';
import type { WIDGET_RUNTIME_API_GROUPS } from './CONSTANTS';

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

/** Portable resource declarations are owned by the SDK, never by an OSS backend. */
export type TWidgetResourceKind = 'kv' | 'db';
export type TWidgetResourceEffect = 'read' | 'write' | 'read_write';
export type TWidgetResourceOperationParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'bigint'
  | 'bytes'
  | 'json';
export type TWidgetResourceOperationParameterDeclaration = Readonly<{
  type: TWidgetResourceOperationParameterType;
  required?: boolean;
  nullable?: boolean;
}>;
export type TWidgetResourceNamedOperation = Readonly<{
  effect: Exclude<TWidgetResourceEffect, 'read_write'>;
  sql: string;
  parameters?: Readonly<Record<string, TWidgetResourceOperationParameterDeclaration>>;
  result: 'rows' | 'execute';
  /** Named result columns whose SQL text is decoded as bounded portable JSON. */
  jsonColumns?: readonly string[];
}>;
export type TWidgetResourceRequirement = Readonly<{
  slot: string;
  /** Installation-local identity. It is removed from canonical build inputs. */
  resourceId?: string;
  kind: TWidgetResourceKind;
  effect: TWidgetResourceEffect;
  required?: boolean;
  arbitrarySql?: boolean;
  operations?: Readonly<Record<string, TWidgetResourceNamedOperation>>;
}>;
/** Retained source-compatible name; the type is SDK-owned. */
export type TResourceRequirement = TWidgetResourceRequirement;
export type TResourceNamedOperation = TWidgetResourceNamedOperation;
export type TResourceOperationParameterDeclaration =
  TWidgetResourceOperationParameterDeclaration;

/** Capsule content addresses include their digest algorithm domain. */
export type TWidgetArtifactHash = `sha256:${string}`;

/** Public Capsule API groups available to widget authors. */
export type TWidgetRuntimeApiGroup =
  (typeof WIDGET_RUNTIME_API_GROUPS)[number];

export type TWidgetRuntimeApiContract = Readonly<{
  format: 'capsule-api-groups-v1';
  groups: readonly TWidgetRuntimeApiGroup[];
  bundleDigest: TWidgetArtifactHash;
}>;

/** Complete Capsule resource ceiling. Zero is a valid explicit denial. */
export type TWidgetRuntimeBudgets = Readonly<{
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

export type TWidgetRuntimeBudgetRequest = Readonly<Partial<TWidgetRuntimeBudgets>>;

/** Public verification material; private Capsule signing keys never cross this boundary. */
export type TWidgetPublicSigningKey = Readonly<{
  keyId: string;
  algorithm: 'Ed25519';
  format: 'raw';
  publicKeyBase64: string;
}>;

/** Public, cacheable policy required to construct a Capsule browser host. */
export type TWidgetHostConfiguration = Readonly<{
  generation: string;
  allowedApis: readonly TWidgetRuntimeApiGroup[];
  limits: TWidgetRuntimeBudgetRequest;
  previewSigningKeyId: string;
  releaseSigningKeyId: string;
  signingKeys: readonly TWidgetPublicSigningKey[];
}>;

export type TWidgetSchemaReference = Readonly<{
  format: 'capsule-schema-v1';
  hash: TWidgetArtifactHash;
}>;

/**
 * Host-owned widget props are JSON-only canvas data. Capsule applies the
 * concrete depth, item, key, string, and wire-size ceilings at the channel
 * boundary.
 */
export type TWidgetProps = TWidgetSerializableJsonObject;

/** Minimal semantic theme projection exposed to untrusted widget code. */
export type TWidgetTheme = Readonly<{
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
export type TWidgetNotificationOutput = Readonly<{
  type: 'notification';
  tone: 'info' | 'success' | 'error';
  message: string;
}>;

/** Untrusted authority request embedded in a Capsule artifact; it grants nothing. */
export type TWidgetCapabilityRequest = Readonly<{
  id: string;
  versionRange: string;
  contractHash: TWidgetArtifactHash;
  required: boolean;
  operations: readonly string[];
}>;

/** Signed Capsule guest-channel declaration. */
export type TWidgetChannelContract = Readonly<{
  format: 'capsule-guest-channels-v1';
  lifecycle?: true;
  props?: TWidgetSchemaReference;
  theme?: TWidgetSchemaReference;
  output?: TWidgetSchemaReference;
  store?: Readonly<{
    schema: TWidgetSchemaReference;
    maxEntries: number;
  }>;
}>;

/** Parking is deliberately disabled for the first Capsule release. */
export type TWidgetParkability = Readonly<{
  parkable: false;
}>;

export type TWidgetUiManifest = Readonly<{
  runtime: 'capsule';
  entry: string;
  apis: readonly TWidgetRuntimeApiGroup[];
  budgets?: TWidgetRuntimeBudgetRequest;
  state?: Readonly<{
    localStore: 'none' | 'ephemeral';
  }>;
  parkability?: Readonly<{
    enabled: false;
  }>;
}>;

export type TWidgetServerManifest = Readonly<{
  entry: string;
}>;

/** Short-lived server-function effect ceiling emitted by the trusted build. */
export type TWidgetServerFunctionEffect = 'fn' | 'fx' | 'tx';

export type TWidgetServerFunctionResourceAccess = Readonly<{
  slot: string;
  effect: 'read' | 'write' | 'read_write';
}>;

export type TWidgetServerFunctionLimits = Readonly<{
  timeoutMs: number;
  /** Fixed portable ceiling: at most 128 MiB, matching the managed isolate profile. */
  memoryTier: 'small';
  outputByteLimit: number;
  logByteLimit: number;
}>;

/**
 * Canonical, serializable registration emitted for one direct named export.
 * Host-owned identity, revision, and artifact digest are bound by the
 * publication/store record rather than trusted from guest code.
 */
export type TWidgetServerFunctionDescriptor = Readonly<{
  schemaVersion: 1;
  exportName: string;
  effect: TWidgetServerFunctionEffect;
  inputSchema: TWidgetSerializableJsonObject;
  outputSchema: TWidgetSerializableJsonObject;
  resources: readonly TWidgetServerFunctionResourceAccess[];
  limits: TWidgetServerFunctionLimits;
}>;

export type TWidgetServerFunctionDescriptorValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | 'browser_only_has_functions'
        | 'server_has_no_functions'
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
 *
 * New captures use the source digest as `id`. `captureId` and `createdAtMs`
 * describe the incidental capture event and are never construction-key inputs.
 * `captureId` is optional so retained v1 source artifacts remain readable.
 */
export type TWidgetSourceSnapshot = Readonly<{
  id: TWidgetSourceSnapshotId;
  captureId?: string;
  digestSha256: TWidgetArtifactDigest;
  files: readonly TWidgetSourceFile[];
  createdAtMs: number;
}>;

/** Exact pinned Capsule package/build identity used by trusted tooling. */
export type TWidgetRuntimeBuildIdentity = Readonly<{
  packageName: '@omnidraw/capsule';
  packageVersion: string;
  packageDigest: TWidgetArtifactHash;
  buildApiVersion: string;
  runtimeBuildDigest: TWidgetArtifactHash;
}>;

/** Trusted, serializable metadata inspected from exact signed Capsule bytes. */
export type TWidgetRuntimeDescriptor = Readonly<{
  format: 'omnidraw.capsule-runtime.v2';
  artifactHash: TWidgetArtifactHash;
  apiContract: TWidgetRuntimeApiContract;
  budgets: TWidgetRuntimeBudgetRequest;
  capabilityRequests: readonly TWidgetCapabilityRequest[];
  channels: TWidgetChannelContract | null;
  parkability: TWidgetParkability;
  signatureKeyIds: readonly string[];
}>;

export type TWidgetBuildRequest = Readonly<{
  snapshot: TWidgetSourceSnapshot;
  manifest: TWidgetExecutableManifestProjection;
  canonicalManifestJson: string;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
  buildPolicyId: string;
  /** Trusted draft-private workspace identity. Never accepted from a public client. */
  workspaceKey?: string;
  /** Latest-wins cancellation propagated to application-owned guest processes. */
  signal?: AbortSignal;
  reportProgress?: (phase: 'installing' | 'building' | 'validating') => void;
  /** Trusted orchestration choice; never accepted from guest source or a public API payload. */
  signingPurpose: TWidgetArtifactSigningPurpose;
}>;

/** Immutable inputs for artifact construction before any signing authority is selected. */
export type TWidgetArtifactConstructionRequest = Omit<
  TWidgetBuildRequest,
  'signingPurpose'
>;

/** Exact signed Capsule bytes plus independently verified runtime metadata. */
export type TWidgetUiArtifact = Readonly<{
  kind: 'ui';
  digestSha256: TWidgetArtifactDigest;
  bytes: Uint8Array;
  artifactHash: TWidgetArtifactHash;
  runtimeDescriptor: TWidgetRuntimeDescriptor;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
}>;

export type TWidgetUiBuildRequest = TWidgetBuildRequest & Readonly<{
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
}>;

export type TWidgetArtifactSigningPurpose = 'preview' | 'release';

export type TWidgetArtifactSignRequest = Readonly<{
  unsignedBytes: Uint8Array;
  artifactHash: TWidgetArtifactHash;
  purpose: TWidgetArtifactSigningPurpose;
}>;

export type TWidgetArtifactSignResult = Readonly<{
  signedBytes: Uint8Array;
  signatureKeyIds: readonly string[];
}>;

export type TWidgetArtifactInspectionRequest = Readonly<{
  signedBytes: Uint8Array;
  expectedApis: readonly TWidgetRuntimeApiGroup[];
}>;

export type TWidgetArtifactInspectionResult = Readonly<{
  digestSha256: TWidgetArtifactDigest;
  runtimeDescriptor: TWidgetRuntimeDescriptor;
}>;

export type TWidgetRuntimeDescriptorCreateRequest = Readonly<{
  artifactHash: TWidgetArtifactHash;
  apiContract: TWidgetRuntimeApiContract;
  budgets: TWidgetRuntimeBudgetRequest;
  capabilityRequests: readonly TWidgetCapabilityRequest[];
  channels: TWidgetChannelContract | null;
  signatureKeyIds: readonly string[];
}>;

/** Exact host-neutral ES module emitted before descriptor extraction. */
export type TWidgetServerModule = Readonly<{
  format: 'omnidraw.widget-server-module.v1';
  abi: 'omnidraw.widget-server-abi.v1';
  moduleBytes: Uint8Array;
  moduleDigestSha256: TWidgetArtifactDigest;
}>;

/** Canonical immutable server artifact consumed unchanged by every host adapter. */
export type TWidgetServerModuleArtifact = TWidgetServerModule & Readonly<{
  kind: 'server_module';
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
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

export type TWidgetDiagnostic = Readonly<{
  formatVersion: 1;
  fingerprint: string;
  origin:
    | 'source'
    | 'install'
    | 'build'
    | 'server'
    | 'capsule'
    | 'host'
    | 'guest'
    | 'capability'
    | 'channel'
    | 'budget'
    | 'lifecycle';
  phase: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  trust: 'trusted' | 'untrusted';
  draftRevision: string;
  previewRevisionId: string | null;
  buildId: string;
  buildSequence: number;
  occurrenceCount: number;
  retryability: 'retryable' | 'non-retryable' | 'unknown';
  timestampMs: number;
  file?: string;
  line?: number;
  column?: number;
  capability?: string;
  operation?: string;
  budgetDimension?: string;
  causeFingerprint?: string;
  remediation?: 'widget-source' | 'generated-binding' | 'platform' | 'budget';
}>;

export type TWidgetDiagnosticFingerprintInput = Pick<
  TWidgetDiagnostic,
  | 'origin'
  | 'phase'
  | 'code'
  | 'file'
  | 'line'
  | 'column'
  | 'capability'
  | 'operation'
  | 'budgetDimension'
  | 'buildId'
  | 'previewRevisionId'
>;

/** Application-owned distribution identity retained with an exact construction. */
export type TWidgetDistributionBuildProvenance = Readonly<{
  kind: 'external-distribution';
  producer: Readonly<{
    name: string;
    version: string;
    digest: TWidgetArtifactHash;
  }>;
  sourceRevision: string;
  dependencyLockDigest: TWidgetArtifactHash;
  buildConfigurationDigest: TWidgetArtifactHash;
}>;

/** Runtime metadata that is stable before Preview or release keys are selected. */
export type TWidgetUnsignedRuntimeDescriptor = Omit<
  TWidgetRuntimeDescriptor,
  'signatureKeyIds'
>;

/** Canonical unsigned Capsule output retained for exact Preview promotion. */
export type TWidgetUnsignedUiArtifact = Readonly<{
  kind: 'unsigned-ui';
  digestSha256: TWidgetArtifactDigest;
  unsignedBytes: Uint8Array;
  artifactHash: TWidgetArtifactHash;
  runtimeDescriptor: TWidgetUnsignedRuntimeDescriptor;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
}>;

/** Stable, signature-independent payload bound to one exact guest construction. */
export type TWidgetConstructionContractPayloadInput = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  sourceArtifactDigestSha256: TWidgetArtifactDigest;
  sourceMapArtifactDigestSha256: TWidgetArtifactDigest | null;
  canonicalManifestJson: string;
  unsignedUiDigestSha256: TWidgetArtifactDigest;
  artifactHash: TWidgetArtifactHash;
  apiContract: TWidgetRuntimeApiContract;
  budgets: TWidgetRuntimeBudgetRequest;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  serverModuleFormat: 'omnidraw.widget-server-module.v1' | null;
  serverModuleAbi: 'omnidraw.widget-server-abi.v1' | null;
  serverModuleDigestSha256: TWidgetArtifactDigest | null;
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
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
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
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
  uiArtifact: TWidgetUnsignedUiArtifact;
  serverArtifact: TWidgetServerModuleArtifact | null;
  diagnostics: readonly TWidgetBuildDiagnostic[];
}>;

export type TWidgetArtifactConstructionSignRequest = Readonly<{
  construction: TWidgetArtifactConstructionResult;
  /** Trusted orchestration choice; never accepted from guest source or a public API payload. */
  signingPurpose: TWidgetArtifactSigningPurpose;
}>;

export type TWidgetBuildResult = Readonly<{
  sourceSnapshotId: TWidgetSourceSnapshotId;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
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
  uiArtifact: TWidgetUiArtifact;
  sourceMapArtifact: TWidgetSourceMapArtifact | null;
  serverArtifact: TWidgetServerModuleArtifact | null;
  diagnostics: readonly TWidgetBuildDiagnostic[];
}>;

type TWidgetContractPayloadBase = Readonly<{
  canonicalManifestJson: string;
  uiDigestSha256: TWidgetArtifactDigest;
  artifactHash: TWidgetArtifactHash;
  capabilityContractDigestSha256: TWidgetArtifactDigest;
  channelContractDigestSha256: TWidgetArtifactDigest;
  signatureKeyIds: readonly string[];
  serverModuleFormat: 'omnidraw.widget-server-module.v1' | null;
  serverModuleAbi: 'omnidraw.widget-server-abi.v1' | null;
  serverModuleDigestSha256: TWidgetArtifactDigest | null;
  functionDescriptorsDigestSha256: TWidgetArtifactDigest;
  sourceDigestSha256: TWidgetArtifactDigest;
  builderIdentity: string;
  capsuleBuildIdentity: TWidgetRuntimeBuildIdentity;
  buildPolicyId: string;
}>;

/** Canonical inputs whose encoding binds one build to its exact outputs. */
export type TWidgetContractPayloadInput = TWidgetContractPayloadBase & Readonly<{
  apiContract: TWidgetRuntimeApiContract;
  budgets: TWidgetRuntimeBudgetRequest;
}>;

export type TWidgetServerFunctionDescriptorExtractionRequest = Readonly<{
  serverModule: TWidgetServerModule;
}>;

/** Stable subject identity supplied by a host to guest state and functions. */
export type TWidgetHostSubject = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  widgetKey: string;
}>;

export type TWidgetCapabilitySelector = Readonly<{
  id: string;
  versionRange: string;
  contractHash: TWidgetArtifactHash;
}>;

export type TWidgetLifecycleState = 'active' | 'throttled' | 'frozen' | 'parked';
export type TWidgetLifecycleEvent = Readonly<{
  state: TWidgetLifecycleState;
  generation: number;
}>;

export type TWidgetSnapshotCaptureContext = Readonly<{
  reason: 'snapshot' | 'freeze' | 'park';
  lifecycleGeneration: number;
}>;
export type TWidgetSnapshotSchemaIdentity = Readonly<{
  id: string;
  version: string;
  contractHash: TWidgetArtifactHash;
}>;
export type TWidgetSnapshotRestoreContext = Readonly<{
  mode: 'same-handle' | 'cold-mount';
  sourceArtifactHash: TWidgetArtifactHash;
  sourceSchema: TWidgetSnapshotSchemaIdentity;
  sourceLifecycleGeneration: number;
  targetArtifactHash: TWidgetArtifactHash;
  targetSchema: TWidgetSnapshotSchemaIdentity;
}>;
export type TWidgetSnapshotHooks = Readonly<{
  capture(context: TWidgetSnapshotCaptureContext): TWidgetSerializableJsonValue;
  restore(value: TWidgetSerializableJsonValue, context: TWidgetSnapshotRestoreContext): void;
  migrate?(
    value: TWidgetSerializableJsonValue,
    context: TWidgetSnapshotRestoreContext,
  ): TWidgetSerializableJsonValue;
}>;

export type TWidgetFunctionInvocation = Readonly<{
  invocationId: string;
  subject: TWidgetHostSubject;
  functionName: string;
  input: TWidgetSerializableJsonValue;
  signal?: AbortSignal;
}>;

export type TWidgetResourceCall = Readonly<{
  subject: TWidgetHostSubject;
  slot: string;
  operation: string;
  effect: TWidgetResourceEffect;
  input: TWidgetSerializableJsonValue;
  signal?: AbortSignal;
}>;

/** Canonical build-once artifact consumed unchanged by OSS and managed hosts. */
export type TWidgetPortableArtifact = Readonly<{
  format: 'omnidraw.widget-artifact.v1';
  manifest: TWidgetExecutableManifestProjection;
  manifestDigestSha256: string;
  ui: Readonly<{
    bytes: Uint8Array;
    digestSha256: string;
    runtime: TWidgetRuntimeDescriptor;
  }>;
  server: TWidgetServerModuleArtifact | null;
  functions: readonly TWidgetServerFunctionDescriptor[];
  artifactDigestSha256: string;
}>;

/** Browser layout and scheduling hints. They grant no guest authority. */
export type TWidgetViewport = Readonly<{
  width: number;
  height: number;
  scale: number;
  visibility: 'visible' | 'hidden';
  distance: number;
  priority: number;
  occlusion: number;
}>;

/** Signed browser artifact after application transport decoding. */
export type TWidgetBrowserArtifact = Readonly<{
  bytes: Uint8Array;
  digestSha256: string;
  artifactHash: TWidgetArtifactHash;
  runtime: TWidgetRuntimeDescriptor;
  functions: readonly TWidgetServerFunctionDescriptor[];
}>;

export type TWidgetHostDiagnosticCategory =
  | 'artifact'
  | 'budget'
  | 'capability'
  | 'channel'
  | 'guest'
  | 'host'
  | 'internal'
  | 'lifecycle'
  | 'target';

/** Bounded product-safe runtime error. Guest messages and stacks are omitted. */
export type TWidgetHostDiagnostic = Readonly<{
  format: 'omnidraw.widget-host-diagnostic.v1';
  phase: 'host' | 'runtime';
  category: TWidgetHostDiagnosticCategory;
  code: string;
  fatal: boolean;
  message: string;
  capability?: string;
  operation?: string;
}>;

export type TWidgetBrowserMountDiagnostics = Readonly<{
  instanceId: string;
  artifactHash: TWidgetArtifactHash;
  state: TWidgetLifecycleState | 'destroyed';
  generation: number;
  viewport?: TWidgetViewport;
}>;

export type TWidgetInspectionRole =
  | 'button' | 'checkbox' | 'combobox' | 'link' | 'listbox' | 'menuitem'
  | 'option' | 'radio' | 'slider' | 'spinbutton' | 'switch' | 'tab' | 'textbox';
export type TWidgetInspectionQuery =
  | Readonly<{ css: string; maxResults?: number }>
  | Readonly<{ role: TWidgetInspectionRole; name?: string; exact?: boolean; maxResults?: number }>
  | Readonly<{ label: string; exact?: boolean; maxResults?: number }>;
export type TWidgetInspectionTarget = Readonly<{
  id: number;
  tagName: string;
  role?: string;
  name: string;
  text: string;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  computed: Readonly<{ display: string; visibility: string; opacity: string }>;
  checked?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  editable: boolean;
  sensitive: boolean;
}>;
export type TWidgetInspectionPointCheck = Readonly<{
  targetId: number;
  valid: boolean;
  reason: 'valid' | 'missing' | 'stale' | 'not_visible' | 'disabled' | 'outside_viewport' | 'occluded';
  centerX?: number;
  centerY?: number;
}>;
export type TWidgetInspectionCanvas = Readonly<{
  id: number;
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  width: number;
  height: number;
  context: '2d' | 'webgl' | 'webgl2' | 'webgpu' | 'unknown';
  contextLost: boolean;
}>;
