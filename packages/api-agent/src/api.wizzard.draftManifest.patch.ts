import { baseAgentOs } from './orpc';

export const apiWizzardDraftManifestPatch = baseAgentOs.wizzard.draftManifest.patch.handler(async ({ input, context }) => {
  return await context.agent.patchDraftManifestWizzard(input.widgetId, input.sessionId, input.patch)
});
