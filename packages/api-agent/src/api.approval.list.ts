import { baseAgentOs } from './orpc';

export const apiApprovalList = baseAgentOs.approval.list.handler(async ({ input, context }) => {
  return context.agent.listChatApprovals(input.widgetId, input.sessionId);
});
