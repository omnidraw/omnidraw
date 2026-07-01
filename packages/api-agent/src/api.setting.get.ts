import { baseAgentOs } from './orpc';

export const apiGetDefinitions = baseAgentOs.settings.get.handler(async ({ input, context }) => {
  return context.agent.settings()
});