import { baseAgentOs } from './orpc';

export const apiChatDraftActorSend = baseAgentOs.chat.draftActor.send.handler(async ({ input, context }) => {
  return context.agent.sendDraftActorChat(input.widgetId, input.sessionId, input.name, input.payload)
});
