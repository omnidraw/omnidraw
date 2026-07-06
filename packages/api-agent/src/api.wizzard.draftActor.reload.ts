import { baseAgentOs } from './orpc';

export const apiWizzardDraftActorReload = baseAgentOs.wizzard.draftActor.reload.handler(async ({ input, context }) => {
  return await context.agent.reloadDraftActorWizzard(input.widgetId, input.sessionId)
});
