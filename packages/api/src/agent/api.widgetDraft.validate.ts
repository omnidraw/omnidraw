import { baseAgentOs } from './orpc';

export const apiWidgetDraftValidate = baseAgentOs.widgetDraft.validate.handler(async ({ input, context }) => {
  return context.agent.validateWidgetDraft(input.draftId, input.expectedRevision);
});
