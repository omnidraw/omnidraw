import { baseAgentOs } from './orpc';

export const apiWizzardConnect = baseAgentOs.wizzard.connect.handler(async ({ input, context }) => {
  return await context.agent.connect(input.widgetId, input.sessionId)
});