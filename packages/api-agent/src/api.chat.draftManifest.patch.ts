import { baseAgentOs } from './orpc';

export const apiChatDraftManifestPatch = baseAgentOs.chat.draftManifest.patch.handler(async ({ input, context }) => {
  return await context.agent.patchDraftManifestChat(input.widgetId, input.sessionId, input.patch)
});
