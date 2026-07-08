import { baseAgentOs } from './orpc';

export const apiWizzardPublish = baseAgentOs.wizzard.publish.handler(async ({ input, context }) => {
  return await context.agent.publishWizzard(input.widgetId, input.sessionId)
});
