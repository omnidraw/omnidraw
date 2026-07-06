import { baseAgentOs } from './orpc';

export const apiWizzardNewSession = baseAgentOs.wizzard.newSession.handler(async ({ input, context }) => {
  context.agent.newWizzardSession(input.widgetId, input.sessionId)
});
