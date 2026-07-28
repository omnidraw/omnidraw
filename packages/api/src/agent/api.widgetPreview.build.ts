import { baseAgentOs } from './orpc';

export const apiWidgetPreviewBuild = baseAgentOs.widgetPreview.build.handler(async ({ input, context }) => {
  return context.agent.buildWidgetPreview(
    input.draftId,
    input.previewId === undefined
      ? undefined
      : {
          previewId: input.previewId,
          canvasId: input.canvasId!,
          frameNodeId: input.frameNodeId!,
        },
  );
});
