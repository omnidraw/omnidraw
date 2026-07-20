import { baseAgentOs } from './orpc';

export const apiWidgetPreviewSend = baseAgentOs.widgetPreview.send.handler(async ({ input, context }) => {
  return context.agent.sendWidgetPreview(input.draftId, input.previewId, input.expectedRevision, input.name, input.payload);
});
