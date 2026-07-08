import { baseAgentOs } from './orpc';

export const apiWizzardCancel = baseAgentOs.wizzard.cancel.handler(async ({ input, context }) => {
  return await context.agent.cancelWizzard(input.widgetId, input.sessionId)
});
