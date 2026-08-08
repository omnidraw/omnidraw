import { baseAgentOs } from './orpc';

export const apiChatEdit = baseAgentOs.chat.edit.handler(async ({ input, context }) => {
  return await context.agent.editChatMessage(
    input.widgetId,
    input.sessionId,
    input.entryId,
    input.text,
    { model: input.model, thinkingLevel: input.thinkingLevel },
  )
})
