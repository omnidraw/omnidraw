import { baseAgentOs } from './orpc';

export const apiWizzardDbChangeApprove = baseAgentOs.wizzard.dbChange.approve.handler(async ({ input, context }) => {
  return context.agent.approveWizzardDbChange(input.widgetId, input.sessionId, input.proposalId);
});
