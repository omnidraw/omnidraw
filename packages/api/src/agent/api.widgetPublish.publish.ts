import { baseAgentOs } from './orpc';

export const apiWidgetPublishPublish = baseAgentOs.widgetPublish.publish.handler(async ({ input, context }) => {
  return context.agent.publishWidgetDraft(
    input.draftId,
    input.expectedRevision,
    {
      idempotencyKey: input.idempotencyKey,
      previewId: input.previewId,
      previewRevisionId: input.previewRevisionId,
      canvasId: input.canvasId,
      frameNodeId: input.frameNodeId,
      expectedBindingRevision: input.expectedBindingRevision,
      expectedBindingPlanDigestSha256: input.expectedBindingPlanDigestSha256,
    },
  );
});
