import type { SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TValidationResult } from '../core/types';
import type { TWidgetDraftSummary } from '../widget-drafts/types';
export type { TValidationResult } from '../core/types';

export type TWidgetEditSessionRecord = {
  mode: 'edit-published-widget';
  sourceDefinitionName: string;
  sourceSlug: string;
  sourceName: string;
  sourceManifestPath: string;
  previousVersion?: string;
  nextVersion: string;
  startedAt: string;
};

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

export type TWidgetDraftResourceBindingSelectionRecord = {
  resources: TWidgetResourceSelection[];
  selectedAt: string;
  source: 'mention' | 'explicit-clear';
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

export type TWidgetDraftChangeResult = TWidgetDraftSummary | null | void;

export type TWidgetDraftChangeHandler = (
  change: TWidgetDraftChange,
) => TWidgetDraftChangeResult | Promise<TWidgetDraftChangeResult>;

export type TToolDefinition = ToolDefinition<any, unknown, any>;

export type TSessionEntryManager = Pick<SessionManager, 'appendCustomEntry' | 'getEntries'>;
