import { baseAgentOs } from './orpc';

export const apiChatDraftManifestRead = baseAgentOs.chat.draftManifest.read.handler(async ({ input, context }) => {
  return await context.agent.readDraftManifestChat(input.widgetId, input.sessionId)
});
