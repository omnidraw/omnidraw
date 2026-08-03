import { baseAgentOs } from './orpc';

export const apiWidgetPublishPublish = baseAgentOs.widgetPublish.publish.handler(async ({ input, context }) => {
  return context.agent.publishWidgetDraft(
    input.draftId,
    {
      idempotencyKey: input.idempotencyKey,
      previewId: input.previewId,
      canvasId: input.canvasId,
      frameNodeId: input.frameNodeId,
    },
  );
});
