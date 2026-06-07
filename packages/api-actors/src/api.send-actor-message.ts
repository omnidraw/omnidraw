import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanEditCanvas, fxGetActorInstance } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiSendActorMessage = baseActorsOs.messages.send.handler(async ({ input, context }) => {
  const db = getActorsDb(context.db);
  const instance = await fxGetActorInstance({ db }, { id: input.actorInstanceId });
  if (!instance) throw new ORPCError('NOT_FOUND', { message: 'Actor instance not found' });

  if (!(await fxCanEditCanvas({ db }, { canvasId: instance.canvas_id, accountId: context.accountId }))) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot send actor message on this canvas' });
  }

  if (!context.actor) {
    throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Actor runtime is not available' });
  }

  return await context.actor.sendMessage({
    actorInstanceId: input.actorInstanceId,
    eventName: input.eventName,
    params: input.params ?? {},
    correlationId: input.correlationId,
  });
});

export { apiSendActorMessage };
