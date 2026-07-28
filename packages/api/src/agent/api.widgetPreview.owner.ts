import { baseAgentOs } from './orpc';

export const apiWidgetPreviewOwnerEnsure = baseAgentOs.widgetPreview.owner.ensure.handler(
  async ({ input, context }) => context.agent.ensureWidgetPreviewOwner(input),
);

export const apiWidgetPreviewOwnerGet = baseAgentOs.widgetPreview.owner.get.handler(
  async ({ input, context }) => context.agent.getWidgetPreviewOwner(input),
);

export const apiWidgetPreviewOwnerList = baseAgentOs.widgetPreview.owner.list.handler(
  async ({ input, context }) => context.agent.listWidgetPreviewOwners(input),
);

export const apiWidgetPreviewOwnerClose = baseAgentOs.widgetPreview.owner.close.handler(
  async ({ input, context }) => context.agent.closeWidgetPreviewOwner(input),
);
