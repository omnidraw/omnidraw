import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from './orpc';

const apiActorSnapshot = baseActorsOs.instances.snapshot.handler(async ({ context, input }) => {
  const actorInstance = 'instanceId' in input
    ? await context.db.actor.getInstanceById(context.tenant, input.instanceId)
    : await context.db.actor.getInstanceByElementId(context.tenant, input.elementId)
  if (!actorInstance) throw new ORPCError('NOT_FOUND')
  return {
    context: actorInstance.machine_context,
    state: actorInstance.machine_state,
    status: actorInstance.status,
    error: actorInstance.last_error,
  }
});

export { apiActorSnapshot };
