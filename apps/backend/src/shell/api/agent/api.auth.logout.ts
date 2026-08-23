import { baseAgentOs } from './procedure-builder';

export const apiAuthLogout = baseAgentOs.auth.logout.handler(async ({ input, context }) => {
  await context.agent.logout(input.providerId)

  return { providerId: input.providerId }
});
