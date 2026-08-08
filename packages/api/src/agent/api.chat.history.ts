import { baseAgentOs } from './orpc';

export const apiChatHistory = baseAgentOs.chat.history.handler(({ input, context }) => {
  return context.agent.getChatHistory(input.widgetId, input.sessionId)
})
