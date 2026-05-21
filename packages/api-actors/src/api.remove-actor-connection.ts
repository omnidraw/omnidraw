import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanEditCanvas, fxGetActorConnection } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txRemoveActorConnection } from './tx.actor-db';

const apiRemoveActorConnection = baseActorsOs.connections.remove.handler(async ({ input, context }) => {
  const existing = fxGetActorConnection({ db: getActorsDb(context.db) }, { id: input.id });
  if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Actor connection not found' });

  if (!fxCanEditCanvas({ db: getActorsDb(context.db) }, { canvasId: existing.canvas_id, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot remove actor connection on this canvas' });
  }

  const connection = txRemoveActorConnection({
    db: getActorsDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { id: input.id });

  if (!connection) throw new ORPCError('NOT_FOUND', { message: 'Actor connection not found' });
  return connection;
});

export { apiRemoveActorConnection };
