import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanEditCanvas, fxGetActorConnection } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txRemoveActorConnection } from './tx.actor-db';

const apiRemoveActorConnection = baseActorsOs.connections.remove.handler(async ({ input, context }) => {
  const existing = fxGetActorConnection({ db: getActorsDrizzleDb(context.db) }, { id: input.id });
  if (!existing) throw new ORPCError('NOT_FOUND', { message: 'Actor connection not found' });

  if (!fxCanEditCanvas({ db: getActorsDrizzleDb(context.db) }, { canvasId: existing.canvas_id, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot remove actor connection on this canvas' });
  }

  const connection = txRemoveActorConnection({
    db: getActorsDrizzleDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { id: input.id });

  if (!connection) throw new ORPCError('NOT_FOUND', { message: 'Actor connection not found' });
  return connection;
});

export { apiRemoveActorConnection };
