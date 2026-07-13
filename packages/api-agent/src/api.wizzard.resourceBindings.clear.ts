import { baseAgentOs } from './orpc';

export const apiWizzardResourceBindingsClear = baseAgentOs.wizzard.resourceBindings.clear.handler(async ({ input, context }) => {
  return context.agent.clearDraftResourceBindingsWizzard(input.widgetId, input.sessionId);
});
