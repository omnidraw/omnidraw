import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanEditCanvas, fxGetActorInstance } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txSendActorMessage } from './tx.actor-db';

const apiSendActorMessage = baseActorsOs.messages.send.handler(async ({ input, context }) => {
  const db = getActorsDrizzleDb(context.db);
  const instance = fxGetActorInstance({ db }, { id: input.actorInstanceId });
  if (!instance) throw new ORPCError('NOT_FOUND', { message: 'Actor instance not found' });

  if (!fxCanEditCanvas({ db }, { canvasId: instance.canvas_id, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot send actor message on this canvas' });
  }

  const updated = txSendActorMessage({
    db,
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { input });

  if (!updated) throw new ORPCError('NOT_FOUND', { message: 'Actor instance not found' });
  return updated;
});

export { apiSendActorMessage };
