import { baseAgentOs } from './procedure-builder';

export const apiChatHistory = baseAgentOs.chat.history.handler(async ({ input, context }) => {
  return await context.agent.getChatHistory(input.widgetId, input.sessionId)
})
