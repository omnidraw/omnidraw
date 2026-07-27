import { baseAgentOs } from './orpc';

export const apiChatApprovalList = baseAgentOs.chat.approval.list.handler(async ({ input, context }) => {
  return context.agent.listChatApprovals(input.widgetId, input.sessionId)
});
