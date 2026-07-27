import type { ICanvasService } from '@vibecanvas/service-canvas';
import type { IWidgetStateService } from '@vibecanvas/service-widget-state';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactReader,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetCapsuleHostConfigurationReader,
  IWidgetRevisionReader,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleHostTargetBase,
  TWidgetCapsulePublicSigningKey,
} from '@vibecanvas/widget-contract';

type TWidgetCapsuleHostConfigurationCapability =
  IWidgetCapsuleHostConfigurationReader;

type TWidgetRuntimeApiCapability = IWidgetRevisionReader
  & IWidgetArtifactReader
  & IWidgetBrowserUiArtifactReadCapabilityIssuer;

type TWidgetRuntimeLoadAdmissionCapability = Readonly<{
  run<TResult>(
    tenant: TTenantContext,
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
  tenant: TTenantContext;
  widget: TWidgetRuntimeApiCapability;
  widgetState: IWidgetStateService;
  widgetCapsuleHostConfiguration: TWidgetCapsuleHostConfigurationCapability;
  widgetRuntimeLoadAdmission: TWidgetRuntimeLoadAdmissionCapability;
}>;

export type {
  TWidgetApiContext,
  TWidgetCapsuleHostConfiguration,
  TWidgetCapsuleHostConfigurationCapability,
  TWidgetCapsuleHostTargetBase,
  TWidgetCapsulePublicSigningKey,
  TWidgetRuntimeApiCapability,
  TWidgetRuntimeLoadAdmissionCapability,
  TWidgetRuntimeLoadCleanupRegistrar,
};
