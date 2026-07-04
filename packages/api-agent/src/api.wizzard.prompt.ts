import { baseAgentOs } from './orpc';

export const apiWizzardPrompt = baseAgentOs.wizzard.prompt.handler(async ({ input, context }) => {
  await context.agent.promptWizzard(input.widgetId, input.sessionId, input.text, input.model)
});
