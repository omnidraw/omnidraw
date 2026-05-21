import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanEditCanvas, fxGetActorConnection } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txUpdateActorConnection } from './tx.actor-db';

const apiUpdateActorConnection = baseActorsOs.connections.update.handler(async ({ input, context }) => {
  const existing = fxGetActorConnection({ db: getActorsDb(context.db) }, { id: input.id });
  if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Actor connection not found' });

  if (!fxCanEditCanvas({ db: getActorsDb(context.db) }, { canvasId: existing.canvas_id, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot update actor connection on this canvas' });
  }

  const connection = txUpdateActorConnection({
    db: getActorsDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { input });

  if (!connection) throw new ORPCError('NOT_FOUND', { message: 'Actor connection not found' });
  return connection;
});

export { apiUpdateActorConnection };
