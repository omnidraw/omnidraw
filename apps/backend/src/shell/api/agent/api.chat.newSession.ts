import { baseAgentOs } from './procedure-builder';

export const apiChatNewSession = baseAgentOs.chat.newSession.handler(async ({ input, context }) => {
  await context.agent.newChatSession(input.widgetId, input.sessionId)
  return null
});
