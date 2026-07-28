import { baseAgentOs } from './orpc';

export const apiWidgetPreviewCancel = baseAgentOs.widgetPreview.cancel.handler(
  async ({ input, context }) => context.agent.cancelWidgetPreviewBuild(input),
);
