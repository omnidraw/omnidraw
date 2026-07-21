import { baseAgentOs } from './orpc';

export const apiChatDraftActorInspect = baseAgentOs.chat.draftActor.inspect.handler(async ({ input, context }) => {
  return context.agent.inspectDraftActorChat(input.widgetId, input.sessionId)
});
