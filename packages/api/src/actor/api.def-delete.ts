import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from './orpc';

export const apiDeleteDefinition = baseActorsOs.definitions.delete.handler(async ({ input, context }) => {
  const deleted = await context.actor.deleteDefinition(input.name)
  if (!deleted) {
    throw new ORPCError('NOT_FOUND')
  }

  context.eventPublisher.publishAgentEvent(context.tenant, {
    kind: 'widgetupdate',
    widgetId: input.name,
    sessionId: 'definition-delete',
    cwd: '',
    files: [],
  })

  return { deleted }
});
