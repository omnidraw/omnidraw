import { baseAgentOs } from './orpc';

export const apiWizzardDraftActorReset = baseAgentOs.wizzard.draftActor.reset.handler(async ({ input, context }) => {
  return await context.agent.resetDraftActorWizzard(input.widgetId, input.sessionId)
});
