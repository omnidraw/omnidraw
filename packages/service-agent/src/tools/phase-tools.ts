import { fxLatestActorCandidateApprovalRecord, fxLatestWidgetEditSessionRecord } from '../core/fx.session-candidate';
import type { TActorServiceReloader, TCandidateSessionManager, TToolDefinition, TToolEventSink, TWidgetWizardPhase } from './types';
import { createApproveActorCandidateTool } from './tool.approve-actor-candidate';
import { createInspectResourceTool } from './tool.inspect-resource';
import { createListResourcesTool } from './tool.list-resources';
import { createPublishWidgetTool } from './tool.publish-widget';
import { createProposeDbChangeTool } from './tool.propose-db-change';
import { createQueryDbReadonlyTool } from './tool.query-db-readonly';
import { createSetActorCandidateTool } from './tool.set-actor-candidate';
import { createValidateWidgetFilesTool } from './tool.validate-widget-files';
import { createWebFetchTool } from './tool.web-fetch';

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

export function getWidgetWizardPhase(sessionManager: TCandidateSessionManager): TWidgetWizardPhase {
  return fxLatestActorCandidateApprovalRecord({ sessionManager }) ? 'implementation' : 'actor-candidate';
}

export function createWidgetWizardPhaseTools(args: TCreateWidgetWizardPhaseToolsArgs): TWidgetWizardPhaseTools {
  const phase = args.phase ?? getWidgetWizardPhase(args.sessionManager);
  const editSession = fxLatestWidgetEditSessionRecord({ sessionManager: args.sessionManager });

  if (phase === 'actor-candidate') {
    return {
      builtInTools: [],
      customTools: [
        createWebFetchTool(),
        createListResourcesTool({ actorService: args.actorService, sessionManager: args.sessionManager }),
        createInspectResourceTool({ actorService: args.actorService }),
        createQueryDbReadonlyTool({ actorService: args.actorService, sessionManager: args.sessionManager }),
        createProposeDbChangeTool({ actorService: args.actorService, sessionManager: args.sessionManager }),
        createSetActorCandidateTool({ cwd: args.cwd, sessionManager: args.sessionManager, onEvent: args.onEvent }),
        createApproveActorCandidateTool({ cwd: args.cwd, sessionManager: args.sessionManager, onEvent: args.onEvent }),
      ],
    };
  }

  return {
    builtInTools: ['read', 'edit', 'grep'],
    customTools: [
      createWebFetchTool(),
      createListResourcesTool({ actorService: args.actorService, sessionManager: args.sessionManager }),
      createInspectResourceTool({ actorService: args.actorService }),
      createQueryDbReadonlyTool({ actorService: args.actorService, sessionManager: args.sessionManager }),
      createProposeDbChangeTool({ actorService: args.actorService, sessionManager: args.sessionManager }),
      createValidateWidgetFilesTool({ cwd: args.cwd }),
      createPublishWidgetTool({
        cwd: args.cwd,
        finalWidgetsDir: args.finalWidgetsDir,
        sessionManager: args.sessionManager,
        actorService: args.actorService,
        editSession: editSession ?? undefined,
        onEvent: args.onEvent,
      }),
    ],
  };
}
