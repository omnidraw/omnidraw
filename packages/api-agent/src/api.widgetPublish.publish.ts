import { baseAgentOs } from './orpc';

export const apiWidgetPublishPublish = baseAgentOs.widgetPublish.publish.handler(async ({ input, context }) => {
  return context.agent.publishWidgetDraft(input.draftId, input.expectedRevision);
});
