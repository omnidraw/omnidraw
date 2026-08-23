import { baseAgentOs } from './procedure-builder';

export const apiChatDbChangeReject = baseAgentOs.chat.dbChange.reject.handler(async ({ input, context }) => {
  return context.agent.rejectChatDbChange(input.widgetId, input.sessionId, input.proposalId);
});
