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
export type TAgentDraftActorSnapshot = {
  state: string;
  context: unknown;
};
export type TAgentChatEvent = {
  widgetId: string;
  sessionId: string;
  event: AgentSessionEvent;
};
export type TAgentDraftActorRuntimeEvent =
  | { readonly kind: 'system'; readonly actorId: string; readonly type: 'ack'; readonly messageId: string; readonly inputName: string }
  | { readonly kind: 'system'; readonly actorId: string; readonly type: 'state.changed'; readonly from: string; readonly to: string; readonly messageId?: string }
  | { readonly kind: 'system'; readonly actorId: string; readonly type: 'status.changed'; readonly from: string | null; readonly to: string }
  | { readonly kind: 'system'; readonly actorId: string; readonly type: 'data.changed'; readonly data: unknown; readonly messageId?: string }
  | { readonly kind: 'system'; readonly actorId: string; readonly type: 'snapshot'; readonly revision: number; readonly state: string; readonly data: unknown; readonly cause: 'startup' | 'input' | 'activity' | 'error'; readonly jobId?: string }
  | { readonly kind: 'system'; readonly actorId: string; readonly type: 'error'; readonly code: string; readonly message: string; readonly details?: unknown; readonly messageId?: string }
  | { readonly kind: 'actor'; readonly actorId: string; readonly name: string; readonly payload: unknown; readonly messageId?: string };
export type TAgentDraftActorEvent = {
  kind: 'draft-actor';
  widgetId: string;
  sessionId: string;
  event: TAgentDraftActorRuntimeEvent | { kind: 'lifecycle'; type: 'stopped'; actorId: string };
  snapshot?: TAgentDraftActorSnapshot;
};
export type TAgentWidgetUpdateEvent = {
  kind: 'widgetupdate';
  widgetId: string;
  sessionId: string;
  cwd: string;
  files: string[];
};
export type TAgentApprovalEvent = {
  kind: 'approval';
  widgetId: string;
  sessionId: string;
  type: 'created' | 'resolved' | 'canceled';
  approval: {
    id: string;
    chatId: string;
    toolCallId: string;
    kind: 'resource-create' | 'resource-update' | 'resource-delete' | 'resource-data-write';
    summary: string;
    risk: 'medium' | 'high';
    warnings: string[];
    details: unknown;
    createdAt: string;
    expiresAt: string;
  };
  decision?: 'approve' | 'reject';
  reason?: string;
};
export type TAgentWidgetDraftEvent = {
  kind: 'widget-draft';
  type: 'created' | 'changed' | 'validated';
  draftId: string;
  revision: string;
};
export type TAgentWidgetPreviewEvent = {
  kind: 'widget-preview';
  type: 'changed' | 'catalog-changed';
  draftId: string;
  revision: string;
};
export type TAgentWidgetPublishedEvent = {
  kind: 'widget-published';
  draftId: string;
  revision: string;
  definitionName: string;
};
export type TAgentWidgetCatalogEvent = {
  kind: 'widget-catalog';
  type: 'changed';
};
export type TAgentEvent =
  | TAgentChatEvent
  | TAgentDraftActorEvent
  | TAgentWidgetUpdateEvent
  | TAgentApprovalEvent
  | TAgentWidgetDraftEvent
  | TAgentWidgetPreviewEvent
  | TAgentWidgetPublishedEvent
  | TAgentWidgetCatalogEvent;
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
