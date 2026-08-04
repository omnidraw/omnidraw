import type { SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TValidationResult } from '../core/types';
export type { TValidationResult } from '../core/types';

export type TWidgetResourceSelection = {
  id: string;
  kind: 'kv' | 'secretStore' | 'db';
  name: string;
  status: 'created' | 'provisioning' | 'ready' | 'migrating' | 'error' | 'deleting';
};

export type TWidgetResourceSelectionRecord = {
  resources: TWidgetResourceSelection[];
  selectedAt: string;
};

export type TWidgetDbChangeProposalRecord = {
  id: string;
  resourceId: string;
  resourceName: string;
  sql: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  proposedAt: string;
  resolvedAt?: string;
  draftId?: string;
  applyId?: string;
  warnings?: string[];
};

export type TToolEvent =
  { type: 'widgetupdate'; cwd: string; files: string[] };

export type TToolEventSink = (event: TToolEvent) => void | Promise<void>;

export type TWidgetDraftChange = {
  name: string;
  chatId?: string;
  type: 'created' | 'changed' | 'validated';
  validation?: TValidationResult;
};

export type TWidgetDraftChangeResult = Readonly<{
  draftId: string;
  revision: string;
  validation: Readonly<{
    status: 'unknown' | 'valid' | 'invalid';
    errors: readonly string[];
    warnings: readonly string[];
  }>;
}> | null | void;

export type TWidgetDraftChangeHandler = (
  change: TWidgetDraftChange,
) => TWidgetDraftChangeResult | Promise<TWidgetDraftChangeResult>;

export type TToolDefinition = ToolDefinition<any, unknown, any>;

export type TSessionEntryManager = Pick<SessionManager, 'appendCustomEntry' | 'getEntries'>;
