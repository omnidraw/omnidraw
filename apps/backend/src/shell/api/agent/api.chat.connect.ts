import { baseAgentOs } from './procedure-builder';

export const apiChatConnect = baseAgentOs.chat.connect.handler(async ({ input, context }) => {
  return await context.agent.connectChat(
    input.widgetId,
    input.sessionId,
    input.canvasId,
    input.mode ?? 'reuse',
  )
})
