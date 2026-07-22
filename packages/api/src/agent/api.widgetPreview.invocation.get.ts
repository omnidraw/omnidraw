import { baseAgentOs } from './orpc';

export const apiWidgetPreviewGetInvocation = baseAgentOs.widgetPreview.invocation.get.handler(
  async ({ input, context }) => context.agent.getWidgetPreviewFunctionInvocation(
    input.draftId,
    input.previewId,
    input.previewRevisionId,
    input.invocationId,
  ),
);
