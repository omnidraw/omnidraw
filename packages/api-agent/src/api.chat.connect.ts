import { baseAgentOs } from './orpc';

export const apiChatConnect = baseAgentOs.chat.connect.handler(async ({ input, context }) => {
  return await context.agent.connectChat(input.widgetId, input.sessionId, {
    accountId: context.accountId,
    requestId: context.requestId,
  }, input.mode ?? 'reuse')
});
