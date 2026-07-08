import { baseAgentOs } from './orpc';

export const apiWizzardDraftActorStop = baseAgentOs.wizzard.draftActor.stop.handler(async ({ input, context }) => {
  return context.agent.stopDraftActorWizzard(input.widgetId, input.sessionId)
});
