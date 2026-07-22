import { baseAgentOs } from './orpc';

export const apiWidgetPreviewInvoke = baseAgentOs.widgetPreview.invoke.handler(async ({ input, context }) => {
  return context.agent.invokeWidgetPreviewFunction(
    input.draftId,
    input.previewId,
    input.previewRevisionId,
    input.functionName,
    input.input,
    input.idempotencyKey,
  );
});
