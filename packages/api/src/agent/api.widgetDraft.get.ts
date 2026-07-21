import { baseAgentOs } from './orpc';

export const apiWidgetDraftGet = baseAgentOs.widgetDraft.get.handler(async ({ input, context }) => {
  return context.agent.getWidgetDraft(input.draftId);
});
