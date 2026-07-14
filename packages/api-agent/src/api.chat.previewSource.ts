import { baseAgentOs } from './orpc';

export const apiChatPreviewSource = baseAgentOs.chat.previewSource.handler(async ({ input, context }) => {
  return await context.agent.previewSourceChat(input.widgetId, input.sessionId)
});
