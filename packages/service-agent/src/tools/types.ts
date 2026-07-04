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

export type TToolEvent =
  | { type: 'actorCandidateChanged'; cwd: string; revision: number; candidate: TActorCandidate; manifest: TVibecanvasJson; validation: TValidationResult }
  | { type: 'widgetupdate'; cwd: string; files: string[] };

export type TToolEventSink = (event: TToolEvent) => void | Promise<void>;

export type TToolDefinition = ToolDefinition<any, unknown, any>;

export type TCandidateSessionManager = Pick<SessionManager, 'appendCustomEntry' | 'getEntries'>;
