import { baseAgentOs } from './orpc';

export const apiApprovalGet = baseAgentOs.approval.get.handler(async ({ input, context }) => {
  return context.agent.getChatApproval(input.widgetId, input.sessionId, input.approvalId);
});
