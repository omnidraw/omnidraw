import { baseAgentOs } from './orpc';

export const apiGetDefinitions = baseAgentOs.auth.login.handler(async ({ input, context }) => {
  const loginId = await context.agent.login(input.providerId)

  return {loginId}
});