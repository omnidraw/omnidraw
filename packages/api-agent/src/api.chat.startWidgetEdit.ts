import { baseAgentOs } from './orpc';

export const apiChatStartWidgetEdit = baseAgentOs.chat.startWidgetEdit.handler(async ({ input, context }) => {
  return await context.agent.startWidgetEditChat(input.widgetId, input.sessionId, input.definitionName)
});
