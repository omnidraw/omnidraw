import { baseAgentOs } from './orpc';

export const apiWidgetPreviewCancelInvocation = baseAgentOs.widgetPreview.invocation.cancel.handler(
  async ({ input, context }) => context.agent.cancelWidgetPreviewFunctionInvocation(
    input.draftId,
    input.previewId,
    input.previewRevisionId,
    input.invocationId,
  ),
);
