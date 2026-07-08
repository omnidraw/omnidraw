import { baseAgentOs } from './orpc';

export const apiWizzardDraftActorStart = baseAgentOs.wizzard.draftActor.start.handler(async ({ input, context }) => {
  return await context.agent.startDraftActorWizzard(input.widgetId, input.sessionId)
});
