import { baseAgentOs } from './orpc';

export const apiChatDraftActorStop = baseAgentOs.chat.draftActor.stop.handler(async ({ input, context }) => {
  return context.agent.stopDraftActorChat(input.widgetId, input.sessionId)
});
