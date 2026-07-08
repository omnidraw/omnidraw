import { baseAgentOs } from './orpc';

export const apiWizzardStartWidgetEdit = baseAgentOs.wizzard.startWidgetEdit.handler(async ({ input, context }) => {
  return await context.agent.startWidgetEditWizzard(input.widgetId, input.sessionId, input.definitionName)
});
