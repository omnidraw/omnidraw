import type { IAutomergeService } from '@vibecanvas/service-automerge/IAutomergeService';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  IWidgetArtifactReader,
  IWidgetBrowserUiArtifactReadCapabilityIssuer,
  IWidgetRevisionReader,
} from '@vibecanvas/widget-contract';
import type { TCanvasDatabaseCapability } from '../interface';

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
  widgetRuntimeLoadAdmission: TWidgetRuntimeLoadAdmissionCapability;
}>;

export type {
  TWidgetApiContext,
  TWidgetRuntimeApiCapability,
  TWidgetRuntimeAutomergeCapability,
  TWidgetRuntimeLoadAdmissionCapability,
  TWidgetRuntimeLoadCleanupRegistrar,
};
