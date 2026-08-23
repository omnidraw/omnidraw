import { baseAgentOs } from './procedure-builder';

export const apiAuthApiKeySet = baseAgentOs.auth.apiKey.set.handler(async ({ input, context }) => {
  await context.agent.setApiKey(input.providerId, input.key)

  return { providerId: input.providerId }
});
