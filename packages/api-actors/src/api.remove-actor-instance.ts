import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanEditCanvas, fxGetActorInstance } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txRemoveActorInstance } from './tx.actor-db';

const apiRemoveActorInstance = baseActorsOs.instances.remove.handler(async ({ input, context }) => {
  const existing = fxGetActorInstance({ db: getActorsDb(context.db) }, { id: input.id });
  if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Actor instance not found' });

  if (!fxCanEditCanvas({ db: getActorsDb(context.db) }, { canvasId: existing.canvas_id, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot remove actor instance on this canvas' });
  }

  const instance = txRemoveActorInstance({
    db: getActorsDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { id: input.id });

  if (!instance) throw new ORPCError('NOT_FOUND', { message: 'Actor instance not found' });
  return instance;
});

export { apiRemoveActorInstance };
