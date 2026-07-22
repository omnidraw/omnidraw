import type { TOrpcSafeClient } from '@vibecanvas/orpc-client';
import type { TWidgetBrowserPort } from '@vibecanvas/ui-ai-chat';

type TApi = TOrpcSafeClient['api'];

export type TLegacyActorUiTransportPort = Readonly<{
  api: Readonly<{
    actors: Pick<TApi['actors'], 'definitions' | 'instances' | 'events'>;
    agent?: Pick<TApi['agent'], 'events'>;
  }>;
}>;

export type TCreateLegacyActorUiCapabilityArgs = Readonly<{
  browser: TWidgetBrowserPort;
  transport: TLegacyActorUiTransportPort;
}>;
