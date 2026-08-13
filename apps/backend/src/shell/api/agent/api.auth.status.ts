import { baseAgentOs } from './procedure-builder';

export const apiAuthStatus = baseAgentOs.auth.status.handler(async ({ input, context }) => {
  return context.agent.getLoginStatus(input.loginId)
});
