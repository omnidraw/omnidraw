import { baseAgentOs } from './orpc';

export const apiWidgetPreviewGet = baseAgentOs.widgetPreview.get.handler(async ({ input, context }) => {
  return context.agent.getWidgetPreview(input.draftId, input.previewId);
});
