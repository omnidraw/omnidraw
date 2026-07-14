import { baseAgentOs } from './orpc';

export const apiChatDraftActorStart = baseAgentOs.chat.draftActor.start.handler(async ({ input, context }) => {
  return await context.agent.startDraftActorChat(input.widgetId, input.sessionId)
});
