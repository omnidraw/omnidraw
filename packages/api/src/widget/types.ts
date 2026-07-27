import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
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
import type { TCanvasDatabaseCapability } from '../interface';

type TWidgetCapsuleHostConfigurationCapability =
  IWidgetCapsuleHostConfigurationReader;

type TWidgetRuntimeApiCapability = IWidgetRevisionReader
  & IWidgetArtifactReader
  & IWidgetBrowserUiArtifactReadCapabilityIssuer;

type TWidgetRuntimeAutomergeCapability = Pick<
  IAutomergeService,
  'findDocument' | 'releaseDocument'
>;

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
  automerge: TWidgetRuntimeAutomergeCapability;
  db: TCanvasDatabaseCapability;
  tenant: TTenantContext;
  widget: TWidgetRuntimeApiCapability;
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
  TWidgetRuntimeAutomergeCapability,
  TWidgetRuntimeLoadAdmissionCapability,
  TWidgetRuntimeLoadCleanupRegistrar,
};
