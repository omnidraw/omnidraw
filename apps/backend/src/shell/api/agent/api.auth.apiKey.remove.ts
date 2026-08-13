import { baseAgentOs } from './procedure-builder';

export const apiAuthApiKeyRemove = baseAgentOs.auth.apiKey.remove.handler(async ({ input, context }) => {
  await context.agent.removeApiKey(input.providerId)

  return { providerId: input.providerId }
});
