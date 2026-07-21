import { baseAgentOs } from './orpc';

export const apiChatPrompt = baseAgentOs.chat.prompt.handler(async ({ input, context }) => {
  await context.agent.promptChat(input.widgetId, input.sessionId, input.text, {
    images: input.images,
    model: input.model,
    resourceIds: input.resourceIds,
    widgetRefs: input.widgetRefs,
    thinkingLevel: input.thinkingLevel,
  })
});
