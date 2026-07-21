import { baseAgentOs } from './orpc';

export const apiChatResourceBindingsClear = baseAgentOs.chat.resourceBindings.clear.handler(async ({ input, context }) => {
  return context.agent.clearDraftResourceBindingsChat(input.widgetId, input.sessionId);
});
