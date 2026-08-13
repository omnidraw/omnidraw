import { baseAgentOs } from './procedure-builder';

export const apiChatCancel = baseAgentOs.chat.cancel.handler(async ({ input, context }) => {
  return await context.agent.cancelChat(input.widgetId, input.sessionId)
});
