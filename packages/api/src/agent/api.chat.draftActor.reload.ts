import { baseAgentOs } from './orpc';

export const apiChatDraftActorReload = baseAgentOs.chat.draftActor.reload.handler(async ({ input, context }) => {
  return await context.agent.reloadDraftActorChat(input.widgetId, input.sessionId)
});
