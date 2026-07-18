import { baseAgentOs } from './orpc';

export const apiWidgetPreviewRefresh = baseAgentOs.widgetPreview.refresh.handler(async ({ input, context }) => {
  return context.agent.refreshWidgetPreview(input.draftId, input.expectedRevision);
});
