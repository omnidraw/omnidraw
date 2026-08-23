import { baseAgentOs } from './procedure-builder';

export const apiChatEdit = baseAgentOs.chat.edit.handler(async ({ input, context }) => {
  return await context.agent.editChatMessage(
    input.widgetId,
    input.sessionId,
    input.entryId,
    input.text,
    { canvasId: input.canvasId, model: input.model, thinkingLevel: input.thinkingLevel },
  )
})
