import { baseAgentOs } from './orpc';

export const apiWidgetDraftList = baseAgentOs.widgetDraft.list.handler(async ({ context }) => {
  return context.agent.listWidgetDrafts();
});
