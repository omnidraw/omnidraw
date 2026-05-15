import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanEditCanvas } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txCreateActorConnection } from './tx.actor-db';

const apiCreateActorConnection = baseActorsOs.connections.create.handler(async ({ input, context }) => {
  if (!fxCanEditCanvas({ db: getActorsDrizzleDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot create actor connection on this canvas' });
  }

  const connection = txCreateActorConnection({
    db: getActorsDrizzleDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { input, accountId: context.accountId });

  if (!connection) {
    throw new ORPCError('NOT_FOUND', { message: 'Actor instances for connection endpoints were not found' });
  }

  return connection;
});

export { apiCreateActorConnection };
