import type { SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { TVibecanvasActor, TVibecanvasActorWidget, TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../core/types';
export type { TActorServiceReloader, TValidationResult } from '../core/types';

export type TWidgetWizardPhase = 'actor-candidate' | 'implementation';

export type TActorCandidate = {
  slug?: string;
  name: string;
  description?: string;
  actor: Omit<TVibecanvasActor, 'relFunctionPath'> & { relFunctionPath?: string };
  widget: {
    tool: TVibecanvasActorWidget['tool'];
  };
};

export type TActorCandidateRecord = {
  revision: number;
  candidate: TActorCandidate;
  manifest: TVibecanvasJson;
  validation: TValidationResult;
  updatedAt: string;
};

export type TActorCandidateApprovalRecord = {
  candidateRevision: number;
  manifest: TVibecanvasJson;
  files: string[];
  approvedAt: string;
};

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
  | { type: 'actorCandidateChanged'; cwd: string; revision: number; candidate: TActorCandidate; manifest: TVibecanvasJson; validation: TValidationResult }
  | { type: 'widgetupdate'; cwd: string; files: string[] };

export type TToolEventSink = (event: TToolEvent) => void | Promise<void>;

export type TToolDefinition = ToolDefinition<any, unknown, any>;

export type TCandidateSessionManager = Pick<SessionManager, 'appendCustomEntry' | 'getEntries'>;
