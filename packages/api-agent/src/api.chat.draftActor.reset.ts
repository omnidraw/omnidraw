import { baseAgentOs } from './orpc';

export const apiChatDraftActorReset = baseAgentOs.chat.draftActor.reset.handler(async ({ input, context }) => {
  return await context.agent.resetDraftActorChat(input.widgetId, input.sessionId)
});
