import { baseAgentOs } from './orpc';

export const apiWizzardDraftManifestRead = baseAgentOs.wizzard.draftManifest.read.handler(async ({ input, context }) => {
  return await context.agent.readDraftManifestWizzard(input.widgetId, input.sessionId)
});
