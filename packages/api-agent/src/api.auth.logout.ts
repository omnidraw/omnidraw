import { baseAgentOs } from './orpc';

export const apiAuthLogout = baseAgentOs.auth.logout.handler(async ({ input, context }) => {
  context.agent.logout(input.providerId)

  return { providerId: input.providerId }
});
