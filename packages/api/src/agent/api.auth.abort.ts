import { baseAgentOs } from './orpc';

export const apiAuthAbort = baseAgentOs.auth.abort.handler(async ({ input, context }) => {
  context.agent.abortLogin(input.loginId)
});