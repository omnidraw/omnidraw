import { baseAgentOs } from './procedure-builder';

export const apiAuthLogin = baseAgentOs.auth.login.handler(async ({ input, context }) => {
  const loginId = await context.agent.login(input.providerId)

  return { loginId }
});
