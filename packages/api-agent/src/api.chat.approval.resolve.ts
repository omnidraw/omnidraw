import { baseAgentOs } from './orpc';

export const apiChatApprovalResolve = baseAgentOs.chat.approval.resolve.handler(async ({ input, context }) => {
  return context.agent.resolveChatApproval(input.widgetId, input.sessionId, input.approvalId, input.decision, {
    accountId: context.accountId,
    requestId: context.requestId,
  })
});
