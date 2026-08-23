import { baseAgentOs } from './procedure-builder';

export const apiAuthAbort = baseAgentOs.auth.abort.handler(async ({ input, context }) => {
  await context.agent.abortLogin(input.loginId)
  return null
});
