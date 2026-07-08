import { baseAgentOs } from './orpc';

export const apiWizzardDraftActorSend = baseAgentOs.wizzard.draftActor.send.handler(async ({ input, context }) => {
  return context.agent.sendDraftActorWizzard(input.widgetId, input.sessionId, input.name, input.payload)
});
