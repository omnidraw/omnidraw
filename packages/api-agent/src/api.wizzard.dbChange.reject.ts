import { baseAgentOs } from './orpc';

export const apiWizzardDbChangeReject = baseAgentOs.wizzard.dbChange.reject.handler(async ({ input, context }) => {
  return context.agent.rejectWizzardDbChange(input.widgetId, input.sessionId, input.proposalId);
});
