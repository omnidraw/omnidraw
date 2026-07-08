import { baseAgentOs } from './orpc';

export const apiWizzardDraftActorInspect = baseAgentOs.wizzard.draftActor.inspect.handler(async ({ input, context }) => {
  return context.agent.inspectDraftActorWizzard(input.widgetId, input.sessionId)
});
