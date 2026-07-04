/* eslint-disable */
import { fxLatestActorCandidateApprovalRecord } from '../core/fx.session-candidate';
import type { TActorServiceReloader, TCandidateSessionManager, TToolDefinition, TToolEventSink, TWidgetWizardPhase } from './types';
import { createApproveActorCandidateTool } from './tool.approve-actor-candidate';
import { createPublishWidgetTool } from './tool.publish-widget';
import { createSetActorCandidateTool } from './tool.set-actor-candidate';
import { createValidateWidgetFilesTool } from './tool.validate-widget-files';

export type TCreateWidgetWizardPhaseToolsArgs = {
  phase?: TWidgetWizardPhase;
  cwd: string;
  finalWidgetsDir: string;
  sessionManager: TCandidateSessionManager;
  actorService?: TActorServiceReloader;
  onEvent?: TToolEventSink;
};

export type TWidgetWizardPhaseTools = {
  builtInTools: string[];
  customTools: TToolDefinition[];
};

export function fnGetWidgetWizardPhase(sessionManager: TCandidateSessionManager): TWidgetWizardPhase {
  return fxLatestActorCandidateApprovalRecord({ sessionManager }) ? 'implementation' : 'actor-candidate';
}

export function fnCreateWidgetWizardPhaseTools(args: TCreateWidgetWizardPhaseToolsArgs): TWidgetWizardPhaseTools {
  const phase = args.phase ?? fnGetWidgetWizardPhase(args.sessionManager);

  if (phase === 'actor-candidate') {
    return {
      builtInTools: [],
      customTools: [
        createSetActorCandidateTool({ cwd: args.cwd, sessionManager: args.sessionManager, onEvent: args.onEvent }),
        createApproveActorCandidateTool({ cwd: args.cwd, sessionManager: args.sessionManager, onEvent: args.onEvent }),
      ],
    };
  }

  return {
    builtInTools: ['read', 'edit', 'grep'],
    customTools: [
      createValidateWidgetFilesTool({ cwd: args.cwd }),
      createPublishWidgetTool({ cwd: args.cwd, finalWidgetsDir: args.finalWidgetsDir, actorService: args.actorService, onEvent: args.onEvent }),
    ],
  };
}
