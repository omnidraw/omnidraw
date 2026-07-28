import { baseAgentOs } from './orpc';

export const apiWidgetPreviewMountAcquire = baseAgentOs.widgetPreview.mount.acquire.handler(
  async ({ input, context }) => context.agent.acquireWidgetPreviewMountLease(input),
);

export const apiWidgetPreviewMountRenew = baseAgentOs.widgetPreview.mount.renew.handler(
  async ({ input, context }) => context.agent.renewWidgetPreviewMountLease(input),
);

export const apiWidgetPreviewMountRelease = baseAgentOs.widgetPreview.mount.release.handler(
  async ({ input, context }) => context.agent.releaseWidgetPreviewMountLease(input),
);
