import { baseAgentOs } from './orpc';

export const apiAuthLogin = baseAgentOs.auth.login.handler(async ({ input, context }) => {
  const loginId = context.agent.login(input.providerId)

  return {loginId}
});