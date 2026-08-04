import type {
  CapsuleHost,
  CapsuleMountDiagnostics,
  CapsuleViewport,
  CreateCapsuleHostOptions,
} from '@omnidraw/capsule-omnidraw/host';
import type {
  TOmnidrawCapsuleError,
} from '@omnidraw/capsule-omnidraw/contract';
import type { TWidgetFrameNode } from '@omnidraw/cangine';
import type {
  CapsuleCapabilityDescriptor,
  CapsuleSchemaResource,
} from '@omnidraw/capsule-omnidraw/capabilities';
import type { TOrpcSafeClient } from '@omnidraw/orpc-client';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleNotificationOutput,
  TWidgetCapsuleProps,
  TWidgetCapsuleRuntimeDescriptor,
  TWidgetCapsuleTheme,
} from '@omnidraw/widget-contract';
import type { TraceMap } from '@jridgewell/trace-mapping';

type TApi = TOrpcSafeClient['api'];

export type TWidgetRuntimeIdentity = Readonly<{
  orgId: string;
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  widgetKey: string;
  catalogGeneration: number;
}>;

/** Browser-local draft Preview identity; it carries no backend execution authority. */
export type TWidgetPreviewRuntimeIdentity = Readonly<{
  kind: 'draft_preview';
  draftId: string;
  definitionId: string;
  revision: string;
}>;

export type TWidgetArtifactRuntimeIdentity =
  | TWidgetRuntimeIdentity
  | TWidgetPreviewRuntimeIdentity;

export type TWidgetRuntimeLoadRequest = Readonly<{
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
  widgetKey: string;
}>;

export type TWidgetRuntimeLocalTarget = TWidgetRuntimeLoadRequest;

export type TWidgetCollaborativeJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly TWidgetCollaborativeJsonValue[]
  | Readonly<{ [key: string]: TWidgetCollaborativeJsonValue }>;

export type TWidgetCollaborativeStateIdentity = Readonly<{
  orgId: string;
  canvasId: string;
  elementId: string;
  widgetInstanceId: string;
}>;

export type TWidgetCollaborativeStateTransportSnapshot = Readonly<{
  identity: TWidgetCollaborativeStateIdentity;
  state: TWidgetCollaborativeJsonValue;
  version: number;
}>;

export type TWidgetCollaborativeStateTransportChangeResult =
  | Readonly<{
    status: 'changed';
    snapshot: TWidgetCollaborativeStateTransportSnapshot;
  }>
  | Readonly<{
    status: 'conflict';
    snapshot: TWidgetCollaborativeStateTransportSnapshot;
  }>;

export type TWidgetCollaborativeStateTransportPort = Readonly<{
  get(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    signal: AbortSignal;
  }>): Promise<TWidgetCollaborativeStateTransportSnapshot>;
  change(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    expectedVersion: number;
    state: TWidgetCollaborativeJsonValue;
    signal: AbortSignal;
  }>): Promise<TWidgetCollaborativeStateTransportChangeResult>;
  events(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    afterVersion: number;
    signal: AbortSignal;
  }>): Promise<AsyncIterable<TWidgetCollaborativeStateTransportSnapshot>>;
  dispose?(): void;
}>;

export type TWidgetCollaborativeStateSnapshot = Readonly<{
  version: number;
  value: TWidgetCollaborativeJsonValue;
}>;

export type TWidgetCollaborativeStateSession = Readonly<{
  identity: TWidgetCollaborativeStateIdentity;
  get(): Promise<TWidgetCollaborativeStateSnapshot>;
  change(value: TWidgetCollaborativeJsonValue): Promise<TWidgetCollaborativeStateSnapshot>;
  next(afterVersion: number, waitId: string): Promise<TWidgetCollaborativeStateSnapshot>;
  cancel(waitId: string): void;
  dispose(): void;
}>;

export type TWidgetCollaborativeStateBridge = Pick<
  TWidgetCollaborativeStateSession,
  'get' | 'change' | 'next' | 'cancel' | 'dispose'
>;

export type TWidgetCollaborativeStatePort = Readonly<{
  open(args: Readonly<{
    identity: TWidgetCollaborativeStateIdentity;
    signal: AbortSignal;
    isCurrent(): boolean;
  }>): Promise<TWidgetCollaborativeStateSession>;
}>;

export type TWidgetRuntimeTransportPort = Readonly<{
  api: Readonly<{
    widget: Readonly<{
      runtime: Readonly<{
        load: TApi['widget']['runtime']['load'];
      }>;
    }>;
    function: Pick<TApi['function'], 'invoke'>;
  }>;
}>;

export type TWidgetArtifactCodecPort = Readonly<{
  decodeBase64(value: string): Uint8Array;
  digestSha256(value: Uint8Array): Promise<string>;
}>;

/** Exact signed Capsule bytes. The browser never parses a Omnidraw envelope. */
export type TVerifiedWidgetUiArtifact = Readonly<{
  digestSha256: string;
  bytes: Uint8Array;
  capsuleArtifactHash: `sha256:${string}`;
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  retainedByteSize: number;
}>;

export type TVerifiedWidgetSourceMapArtifact = Readonly<{
  digestSha256: string;
  sourceRevision: string;
  capsuleArtifactHash: `sha256:${string}`;
  authoredPaths: readonly string[];
  maps: readonly Readonly<{
    module: string;
    traceMap: TraceMap;
  }>[];
  retainedByteSize: number;
}>;

export type TWidgetServerFunctionClientRequest = Readonly<{
  functionName: string;
  input: unknown;
  signal?: AbortSignal;
}>;

export type TWidgetFunctionHostBridge = Readonly<{
  identity: TWidgetArtifactRuntimeIdentity;
  invoke<TOutput = unknown>(request: TWidgetServerFunctionClientRequest): Promise<TOutput>;
  dispose(): void;
}>;

export type TWidgetCapsuleCapabilityKind =
  | 'server-functions'
  | 'collaborative-state';

export type TWidgetCapsuleCapabilityCatalogEntry = Readonly<{
  kind: TWidgetCapsuleCapabilityKind;
  descriptor: CapsuleCapabilityDescriptor;
}>;

/** Immutable browser-safe deployment policy loaded from the trusted API. */
export type TWidgetCapsuleHostCatalog = Readonly<{
  [TKey in Exclude<keyof TWidgetCapsuleHostConfiguration, 'signingKeys'>]:
    TWidgetCapsuleHostConfiguration[TKey];
}> & Readonly<{
  trustedSigningKeys: ReadonlyMap<string, CryptoKey>;
}>;

/**
 * Per-artifact policy derived locally through the public Omnidraw adapter.
 * It is bound to signed runtime requests before reaching the host coordinator.
 */
export type TWidgetCapsuleMountCatalog = TWidgetCapsuleHostCatalog & Readonly<{
  schemas: readonly CapsuleSchemaResource[];
  capabilities: readonly TWidgetCapsuleCapabilityCatalogEntry[];
}>;

export type TWidgetCapsuleHostFactory = Readonly<{
  create(options: CreateCapsuleHostOptions): Promise<CapsuleHost>;
}>;

export type TWidgetCapsuleThemeSource = Readonly<{
  read(): TWidgetCapsuleTheme;
  subscribe(listener: (theme: TWidgetCapsuleTheme) => void): () => void;
}>;

export type TWidgetCapsuleOutputSink = Readonly<{
  notification(output: TWidgetCapsuleNotificationOutput): void;
}>;

export type TWidgetUiRuntimeHandle = Readonly<{
  ready(): Promise<void>;
  setProps(value: unknown): void;
  setTheme(value: unknown): void;
  setViewport(value: CapsuleViewport): void;
  focus(options?: FocusOptions): void;
  setSchedulingMode(mode: 'active' | 'throttled'): Promise<void>;
  freeze(reason?: string): Promise<void>;
  resume(reason?: string): Promise<void>;
  diagnostics(): CapsuleMountDiagnostics;
  destroy(reason?: string): Promise<void>;
}>;

export type TWidgetUiArtifactMountPort = Readonly<{
  mount(args: Readonly<{
    mode: 'preview' | 'published';
    root: HTMLDivElement;
    identity: TWidgetArtifactRuntimeIdentity;
    artifact: TVerifiedWidgetUiArtifact;
    sourceMapArtifact?: TVerifiedWidgetSourceMapArtifact;
    functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
    browserFunctionDescriptorsDigestSha256: string;
    functionBridge: TWidgetFunctionHostBridge;
    collaborativeStateBridge: TWidgetCollaborativeStateBridge | null;
    props?: TWidgetCapsuleProps;
    onDiagnostic?(error: TOmnidrawCapsuleError): void;
    onFatal(error: unknown): void;
  }>): Promise<TWidgetUiRuntimeHandle>;
  destroy(reason?: string): Promise<void>;
}>;

export type TWidgetUiRuntimeRenderArgs = Readonly<{
  canvasId: string;
  element: Readonly<TWidgetFrameNode>;
  root: HTMLDivElement;
}>;

export type TWidgetUiRuntimeRenderOwner = Readonly<{
  setProps(value: TWidgetCapsuleProps): void;
  setViewport(value: CapsuleViewport): void;
  setFocused(focused: boolean, options?: FocusOptions): void;
  freeze(reason?: string): Promise<void>;
  resume(reason?: string): Promise<void>;
  diagnostics(): CapsuleMountDiagnostics | null;
  destroy(reason?: string): Promise<void>;
}>;

export type TWidgetUiRuntimePreloadedRenderOwner =
  TWidgetUiRuntimeRenderOwner & Readonly<{
    ready(): Promise<void>;
  }>;

export type TWidgetUiRuntimePreloadedRenderArgs = Readonly<{
  apis: readonly string[];
  initialViewport?: CapsuleViewport;
  initiallyFrozen?: boolean;
  swapFrom?: TWidgetUiRuntimePreloadedRenderOwner;
  mount(): Promise<TWidgetUiRuntimeHandle>;
  onError(error: unknown): void;
}>;
