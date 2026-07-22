/**
 * @file Service-owned event contracts that do not depend on API transport schemas.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type TEventJson = unknown;

export type TDbEvent = Readonly<{
  data:
    | Readonly<{
      change: 'insert' | 'update';
      table: string;
      id: string;
      record: Record<string, unknown>;
    }>
    | Readonly<{
      change: 'delete';
      table: string;
      id: string;
    }>;
}>;

export type TNotificationEvent = Readonly<{
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  description?: string;
}>;

export type TAgentChatEvent = Readonly<{
  widgetId: string;
  sessionId: string;
  event: AgentSessionEvent;
}>;

export type TAgentWidgetUpdateEvent = Readonly<{
  kind: 'widgetupdate';
  widgetId: string;
  sessionId: string;
  cwd: string;
  files: string[];
}>;

export type TAgentApprovalEvent = Readonly<{
  kind: 'approval';
  widgetId: string;
  sessionId: string;
  type: 'created' | 'resolved' | 'canceled';
  approval: Readonly<{
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
  }>;
  decision?: 'approve' | 'reject';
  reason?: string;
}>;

export type TAgentWidgetDraftEvent = Readonly<{
  kind: 'widget-draft';
  type: 'created' | 'changed' | 'validated';
  draftId: string;
  revision: string;
}>;

export type TAgentWidgetPreviewEvent = Readonly<{
  kind: 'widget-preview';
  type: 'changed' | 'catalog-changed';
  draftId: string;
  revision: string;
}>;

export type TAgentWidgetPublishedEvent = Readonly<{
  kind: 'widget-published';
  draftId: string;
  revision: string;
  definitionName: string;
}>;

export type TAgentWidgetCatalogEvent = Readonly<{
  kind: 'widget-catalog';
  type: 'changed';
}>;

export type TAgentEvent =
  | TAgentChatEvent
  | TAgentWidgetUpdateEvent
  | TAgentApprovalEvent
  | TAgentWidgetDraftEvent
  | TAgentWidgetPreviewEvent
  | TAgentWidgetPublishedEvent
  | TAgentWidgetCatalogEvent;
