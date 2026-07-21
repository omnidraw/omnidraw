import { baseAgentOs } from './orpc';

export const apiChatDbChangeApprove = baseAgentOs.chat.dbChange.approve.handler(async ({ input, context }) => {
  return context.agent.approveChatDbChange(input.widgetId, input.sessionId, input.proposalId);
});
