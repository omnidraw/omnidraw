import { baseAgentOs } from './orpc';

export const apiChatPublish = baseAgentOs.chat.publish.handler(async ({ input, context }) => {
  return await context.agent.publishChat(input.widgetId, input.sessionId)
});
