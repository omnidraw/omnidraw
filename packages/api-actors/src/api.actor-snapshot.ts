import { ORPCError } from '@orpc/contract';
import { baseActorsOs } from './orpc';

const apiActorSnapshot = baseActorsOs.instances.snapshot.handler(async ({ context, input }) => {
  const actorInstance = await context.db.actor.getInstanceById(input.instanceId)
  if (!actorInstance) throw new ORPCError('NOT_FOUND')
  return {
    context: JSON.parse(actorInstance.machine_context as any),
    state: actorInstance.machine_state
  }
});

export { apiActorSnapshot };
