import type { ICanvasService } from '#backend/shell/canvas/authority';
import type {
  TWidgetCatalogSnapshot,
  TWidgetFilesystemManagementCapability,
} from '#backend/shell/agent';
import type {
  TWidgetRuntimeDescriptor,
} from '@omnidraw/sdk/contract';
import type {
  TWidgetHostConfiguration,
  TWidgetPublicSigningKey,
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/sdk/contract';
import type { IWidgetCapsuleHostConfigurationReader } from '#backend/shell/widget';
import type { IWidgetAuthoringVerification } from '#backend/shell/widget-authoring';

type TWidgetHostConfigurationCapability =
  IWidgetCapsuleHostConfigurationReader;

type TWidgetRuntimeResolution = Readonly<{
  widgetKey: string;
  catalogGeneration: number;
  catalogDigestSha256: string;
  manifest: TWidgetManifestV1;
  release: TWidgetReleaseDescriptor;
  capsuleBytes: Uint8Array;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
}>;

type TWidgetRuntimeApiCapability = TWidgetFilesystemManagementCapability & Readonly<{
  current(): TWidgetCatalogSnapshot;
  refresh(): Promise<TWidgetCatalogSnapshot>;
  catalogObservation(): Readonly<{
    generation: number;
    widgetKeys: readonly string[];
  }>;
  subscribe(listener: (event: Readonly<{
    previousGeneration: number | null;
    generation: number;
    changedWidgetKeys: readonly string[];
    previewWidgetKeys: readonly string[];
  }>) => void): () => void;
  resolvePlacement(args: Readonly<{
    reference: Readonly<{
      source: 'published';
      widgetKey: string;
      catalogGeneration: number;
    }>;
    replacement?: Readonly<{
      canvasId: string;
      elementId: string;
      previewInstanceId: string;
      targetInstanceId: string;
    }>;
  }>): Promise<Readonly<{
    kind: 'published';
    reference: Readonly<{
      source: 'published';
      widgetKey: string;
      catalogGeneration: number;
    }>;
    widgetKey: string;
    catalogGeneration: number;
    bounds: Readonly<{ width: number; height: number }>;
  }>>;
  resolveRuntime(widgetKey: string): Promise<TWidgetRuntimeResolution>;
  isRuntimeResolutionCurrent(
    resolution: Pick<
      TWidgetRuntimeResolution,
      'widgetKey' | 'catalogGeneration' | 'catalogDigestSha256'
    >,
  ): boolean;
}>;

type TWidgetRuntimeLoadAdmissionCapability = Readonly<{
  run<TResult>(
    requestSignal: AbortSignal | undefined,
    operation: (
      lifetimeSignal: AbortSignal,
      deferCleanup: TWidgetRuntimeLoadCleanupRegistrar,
    ) => Promise<TResult>,
  ): Promise<TResult>;
}>;

type TWidgetRuntimeLoadCleanupRegistrar = (
  cleanup: () => Promise<void>,
) => void;

type TWidgetPreviewSessionInput = Readonly<{
  canvasId: string;
  elementId: string;
  widgetKey: string;
}>;

type TWidgetPreviewDiagnosticView = Readonly<{
  severity: 'info' | 'warning' | 'error';
  message: string;
  code: string | null;
  path: string | null;
}>;

export type TWidgetPreviewBuildState = Readonly<{
  phase: 'unbuilt' | 'build_required' | 'restoring' | 'building' | 'validating' | 'ready' | 'rejected';
  acceptedGeneration: number | null;
  current: boolean;
  diagnostics: readonly Readonly<{
    code: string;
    message: string;
    path: string | null;
  }>[];
}>;

/** Process-owned Preview mount payload; never persisted. */
type TWidgetPreviewMountView = Readonly<{
  canvasId: string;
  elementId: string;
  widgetKey: string;
  manifest: Omit<TWidgetManifestV1, 'server'>;
  artifact: Readonly<{
    digestSha256: string;
    byteSize: number;
    bytesBase64: string;
  }>;
  runtimeDescriptor: TWidgetRuntimeDescriptor;
  functionDescriptors: readonly TWidgetServerFunctionDescriptor[];
  browserFunctionDescriptorsDigestSha256: string;
  constructionReused: boolean;
  diagnostics: readonly TWidgetPreviewDiagnosticView[];
}>;

type TWidgetPreviewInvokeResult = Readonly<{
  status: 'succeeded';
  output: unknown;
  diagnostics: Readonly<{
    code: string | null;
    message: string | null;
    logByteSize: number;
    truncated: boolean;
  }>;
}> | Readonly<{
  status: 'failed' | 'cancelled' | 'timed_out';
  output: null;
  failure: Readonly<{
    owner: 'user' | 'platform' | 'cancelled';
    code: string;
    message: string;
  }>;
  diagnostics: Readonly<{
    code: string | null;
    message: string | null;
    logByteSize: number;
    truncated: boolean;
  }>;
}>;

type TWidgetPreviewApiCapability = Readonly<{
  buildState(widgetKey: string): Promise<TWidgetPreviewBuildState>;
  open(
    args: TWidgetPreviewSessionInput,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewMountView>;
  rebuild(
    args: TWidgetPreviewSessionInput,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewMountView>;
  rebuildDraft(
    args: Readonly<{ widgetKey: string }>,
    signal?: AbortSignal,
  ): Promise<Readonly<{
    widgetKey: string;
    acceptedGeneration: number;
    buildIdentity: string;
  }>>;
  load(
    args: TWidgetPreviewSessionInput,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewMountView>;
  close(args: Readonly<{ canvasId: string; elementId: string }>): Promise<boolean>;
  invoke(
    args: Readonly<{
      canvasId: string;
      elementId: string;
      functionName: string;
      input: unknown;
    }>,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewInvokeResult>;
}>;

type TWidgetApiContext = Readonly<{
  canvas: ICanvasService;
  widgetCatalog: TWidgetRuntimeApiCapability;
  widgetPreview: TWidgetPreviewApiCapability;
  widgetAuthoring: IWidgetAuthoringVerification;
  widgetCapsuleHostConfiguration: TWidgetHostConfigurationCapability;
  widgetRuntimeLoadAdmission: TWidgetRuntimeLoadAdmissionCapability;
}>;

export type {
  TWidgetApiContext,
  TWidgetHostConfiguration,
  TWidgetHostConfigurationCapability,
  TWidgetPublicSigningKey,
  TWidgetPreviewApiCapability,
  TWidgetPreviewDiagnosticView,
  TWidgetPreviewInvokeResult,
  TWidgetPreviewMountView,
  TWidgetPreviewSessionInput,
  TWidgetRuntimeApiCapability,
  TWidgetRuntimeResolution,
  TWidgetRuntimeLoadAdmissionCapability,
  TWidgetRuntimeLoadCleanupRegistrar,
};
