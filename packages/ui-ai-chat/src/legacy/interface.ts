import type { IPlugin } from '@vibecanvas/runtime';
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from '@vibecanvas/canvas';
import type { LoggingService } from '@vibecanvas/canvas/services';
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { TWidgetError } from '@vibecanvas/service-db/model';
import type { TWidgetDetail } from '@vibecanvas/orpc-client';
import type { Component } from 'solid-js';
import type { TAiChatApplicationPort, TWidgetBrowserPort } from '../ports';
import type { IWidgetConfig } from '../widget/interface';

export type TLegacyWidgetLoggingPort = Pick<LoggingService, 'warn'>;

export type TLegacyWidgetSandboxMountArgs = Readonly<{
  root: HTMLElement;
  browser: TWidgetBrowserPort;
  element: TElement;
  sandbox: NonNullable<IWidgetConfig['sandbox']>;
  getActorInstanceId: () => string | null;
  onLoading: () => void;
  onError: (error: TWidgetError) => void;
  onRecovered: () => void;
}>;

export type TLegacyWidgetRuntimeAdapter = Readonly<{
  start(): void;
  stop(): void;
  deleteDefinition(name: string): Promise<boolean>;
  mountSandbox(args: TLegacyWidgetSandboxMountArgs): () => void;
}>;

export type TLegacyWidgetRegistrationPort = Readonly<{
  registerWidget(config: IWidgetConfig): void;
  unregisterWidget(kind: string): void;
  setDefinitionError(kind: string, error: TWidgetError): void;
  clearDefinitionError(kind: string): void;
}>;

export type TLegacyWidgetPluginPortal = Readonly<{
  application: TAiChatApplicationPort;
  widgetManager: TLegacyWidgetRegistrationPort;
}>;

export type TLegacyActorStateMachineViewProps = Readonly<{
  manifest: NonNullable<TWidgetDetail['manifest']>;
  variant?: 'panel' | 'embedded';
  title?: string;
}>;

export type TLegacyActorUiCapability = Readonly<{
  createRuntimeAdapter(args: Readonly<{
    logging: TLegacyWidgetLoggingPort;
  }>): TLegacyWidgetRuntimeAdapter;
  createWidgetPlugin(
    portal: TLegacyWidgetPluginPortal,
  ): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig>;
  StateMachineView: Component<TLegacyActorStateMachineViewProps>;
}>;
