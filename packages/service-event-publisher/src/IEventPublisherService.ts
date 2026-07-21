/**
 * @file Event publication capability consumed by services and transport adapters.
 */

import type { IService } from '@vibecanvas/runtime';
import type {
  TActorEvent,
  TAgentEvent,
  TDbEvent,
  TFilesystemEvent,
  TNotificationEvent,
} from './events';

export type {
  TActorEvent,
  TActorStatus,
  TAgentApprovalEvent,
  TAgentChatEvent,
  TAgentDraftActorEvent,
  TAgentDraftActorRuntimeEvent,
  TAgentDraftActorSnapshot,
  TAgentEvent,
  TAgentWidgetCatalogEvent,
  TAgentWidgetDraftEvent,
  TAgentWidgetPreviewEvent,
  TAgentWidgetPublishedEvent,
  TAgentWidgetUpdateEvent,
  TDbEvent,
  TEventJson,
  TFilesystemEvent,
  TNotificationEvent,
} from './events';

export interface IEventPublisherService extends IService {
  publishDbEvent(canvasId: string, event: TDbEvent): void;
  subscribeDbEvents(canvasId: string): AsyncIterable<TDbEvent>;

  publishActorEvent(event: TActorEvent): void;
  subscribeActorEvents(): AsyncIterable<TActorEvent>;

  publishAgentEvent(event: TAgentEvent): void;
  subscribeAgentEvents(): AsyncIterable<TAgentEvent>;

  publishFilesystemEvent(path: string, event: TFilesystemEvent): void;
  subscribeFilesystemEvents(path: string): AsyncIterable<TFilesystemEvent>;

  publishNotification(event: TNotificationEvent): void;
  subscribeNotifications(): AsyncIterable<TNotificationEvent>;
  getLatestNotification(): TNotificationEvent | null;
}
