import { baseAgentOs } from './orpc';

export const apiAuthApiKeySet = baseAgentOs.auth.apiKey.set.handler(async ({ input, context }) => {
  context.agent.setApiKey(input.providerId, input.key)

  return { providerId: input.providerId }
});
