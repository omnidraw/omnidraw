import { baseAgentOs } from './orpc';

export const apiWizzardPreviewSource = baseAgentOs.wizzard.previewSource.handler(async ({ input, context }) => {
  return await context.agent.previewSourceWizzard(input.widgetId, input.sessionId)
});
