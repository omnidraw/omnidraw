import type { ICanvasService } from '@omnidraw/service-canvas';
import type { TCanvasWidgetResourceBindingV1 } from '@omnidraw/canvas-contract';
import type { IWidgetStateService } from '@omnidraw/service-widget-state';
import type {
  TWidgetCatalogSnapshot,
  TWidgetFilesystemManagementCapability,
} from '@omnidraw/service-agent';
import type {
  IWidgetCapsuleHostConfigurationReader,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsulePublicSigningKey,
  TWidgetManifestV4,
  TWidgetReleaseDescriptor,
  TWidgetServerFunctionDescriptor,
} from '@omnidraw/widget-contract';

type TWidgetCapsuleHostConfigurationCapability =
  IWidgetCapsuleHostConfigurationReader;

type TWidgetRuntimeResolution = Readonly<{
  widgetKey: string;
  catalogGeneration: number;
  catalogDigestSha256: string;
  manifest: TWidgetManifestV4;
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

type TWidgetApiContext = Readonly<{
  canvas: ICanvasService;
  widgetCatalog: TWidgetRuntimeApiCapability;
  widgetState: IWidgetStateService;
  widgetCapsuleHostConfiguration: TWidgetCapsuleHostConfigurationCapability;
  widgetRuntimeLoadAdmission: TWidgetRuntimeLoadAdmissionCapability;
}>;

export type {
  TWidgetApiContext,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleHostConfigurationCapability,
  TWidgetCapsulePublicSigningKey,
  TWidgetRuntimeApiCapability,
  TWidgetRuntimeResolution,
  TWidgetRuntimeLoadAdmissionCapability,
  TWidgetRuntimeLoadCleanupRegistrar,
};
