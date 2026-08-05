import type { ICanvasService } from '@omnidraw/service-canvas';
import type { TCanvasWidgetResourceBindingV1 } from '@omnidraw/canvas-contract';
import type { IWidgetStateService } from '@omnidraw/service-widget-state';
import type {
  TWidgetCatalogSnapshot,
  TWidgetFilesystemManagementCapability,
} from '@omnidraw/service-agent';
import type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetCapsuleRuntimeDescriptor,
} from '@omnidraw/widget-contract';
import type {
  IWidgetCapsuleHostConfigurationReader,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsulePublicSigningKey,
  TWidgetManifestV1,
  TWidgetReleaseDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';

type TWidgetCapsuleHostConfigurationCapability =
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
  }>) => void): () => void;
  resolvePlacement(args: Readonly<{
    reference: Readonly<{
      source: 'published';
      widgetKey: string;
      catalogGeneration: number;
    }>;
    resourceBindings?: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>;
  }>): Readonly<{
    kind: 'published';
    reference: Readonly<{
      source: 'published';
      widgetKey: string;
      catalogGeneration: number;
    }>;
    widgetKey: string;
    catalogGeneration: number;
    bounds: Readonly<{ width: number; height: number }>;
    resourceBindings: Readonly<Record<string, TCanvasWidgetResourceBindingV1>>;
  }>;
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

type TWidgetPreviewSelectedResourceInput = Readonly<{
  slot: string;
  resourceId: string;
  effect: 'read' | 'read_write';
}>;

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
  runtimeDescriptor: TWidgetCapsuleRuntimeDescriptor;
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[];
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
  open(
    args: TWidgetPreviewSessionInput & Readonly<{
      selectedResources?: readonly TWidgetPreviewSelectedResourceInput[];
    }>,
    signal?: AbortSignal,
  ): Promise<TWidgetPreviewMountView>;
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
  widgetState: IWidgetStateService;
  widgetCapsuleHostConfiguration: TWidgetCapsuleHostConfigurationCapability;
  widgetRuntimeLoadAdmission: TWidgetRuntimeLoadAdmissionCapability;
}>;

export type {
  TWidgetApiContext,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleHostConfigurationCapability,
  TWidgetCapsulePublicSigningKey,
  TWidgetPreviewApiCapability,
  TWidgetPreviewDiagnosticView,
  TWidgetPreviewInvokeResult,
  TWidgetPreviewMountView,
  TWidgetPreviewSelectedResourceInput,
  TWidgetPreviewSessionInput,
  TWidgetRuntimeApiCapability,
  TWidgetRuntimeResolution,
  TWidgetRuntimeLoadAdmissionCapability,
  TWidgetRuntimeLoadCleanupRegistrar,
};
