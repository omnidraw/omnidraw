import { baseAgentOs } from './orpc';

export const apiWidgetPreviewClose = baseAgentOs.widgetPreview.close.handler(async ({ input, context }) => {
  return context.agent.closeWidgetPreview(
    input.draftId,
    input.previewId,
    input.expectedPreviewRevisionId,
  );
});
