import { baseAgentOs } from './orpc';

export const apiAuthStatus = baseAgentOs.auth.status.handler(async ({ input, context }) => {
  return context.agent.getLoginStatus(input.loginId)
});
