import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { IService } from '@vibecanvas/runtime';
import type { ZDbEventSchema } from '@vibecanvas/api-db/contract';
import type { ZNotificationEvent } from '@vibecanvas/api-notification/contract';
import type { ZActorEvent } from '@vibecanvas/api-actors/contract';
import type { z } from 'zod';

export type TDbEvent = z.infer<typeof ZDbEventSchema>;
export type TNotificationEvent = z.infer<typeof ZNotificationEvent>;
export type TFilesystemEvent = {
  eventType: 'rename' | 'change';
  fileName: string;
};
export type TActorEvent = z.infer<typeof ZActorEvent>
export type TAgentEvent = {
  widgetId: string;
  sessionId: string;
  event: AgentSessionEvent;
};
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
