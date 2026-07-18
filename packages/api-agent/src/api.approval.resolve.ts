import { baseAgentOs } from './orpc';

export const apiApprovalResolve = baseAgentOs.approval.resolve.handler(async ({ input, context }) => {
  return context.agent.resolveChatApproval(input.widgetId, input.sessionId, input.approvalId, input.decision, {
    accountId: context.accountId,
    requestId: context.requestId,
  });
});
