/**
 * @file Service-owned event contracts that do not depend on API transport schemas.
 */

export type TEventJson = unknown;

export type TSequencedEvent<TEvent> = Readonly<{
  event: TEvent;
  sequence: number;
}>;

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
  /** Provider-neutral event payload translated by the shell agent adapter. */
  event: TEventJson;
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
    createdAtSec: string;
    policyMode: 'always-approve' | 'ai-review' | 'manual';
    decisionSource?: 'policy' | 'reviewer' | 'user';
    reviewerReason?: string;
  }>;
  decision?: 'approve' | 'reject';
  reason?: string;
}>;

export type TAgentWidgetCatalogEvent = Readonly<{
  kind: 'widget-catalog';
  type: 'changed';
}>;

export type TAgentEvent =
  | TAgentChatEvent
  | TAgentWidgetUpdateEvent
  | TAgentApprovalEvent
  | TAgentWidgetCatalogEvent;
