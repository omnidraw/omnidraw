import { baseAgentOs } from './orpc';

export const apiWidgetPreviewReset = baseAgentOs.widgetPreview.reset.handler(async ({ input, context }) => {
  return context.agent.resetWidgetPreview(input.draftId, input.expectedRevision);
});
