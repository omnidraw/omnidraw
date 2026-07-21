import { baseAgentOs } from './orpc';

export const apiChatNewSession = baseAgentOs.chat.newSession.handler(async ({ input, context }) => {
  await context.agent.newChatSession(input.widgetId, input.sessionId)
});
