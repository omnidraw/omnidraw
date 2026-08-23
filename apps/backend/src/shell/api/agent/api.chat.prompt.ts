import { baseAgentOs } from './procedure-builder';

export const apiChatPrompt = baseAgentOs.chat.prompt.handler(async ({ input, context }) => {
  await context.agent.promptChat(input.widgetId, input.sessionId, input.text, {
    canvasId: input.canvasId,
    images: input.images,
    model: input.model,
    widgetRefs: input.widgetRefs,
    thinkingLevel: input.thinkingLevel,
  })
  return null
});
