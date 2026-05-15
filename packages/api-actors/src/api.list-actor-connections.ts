import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanViewCanvas, fxListActorConnections } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiListActorConnections = baseActorsOs.connections.list.handler(async ({ input, context }) => {
  if (!fxCanViewCanvas({ db: getActorsDrizzleDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'No access to canvas actor connections' });
  }

  return fxListActorConnections({ db: getActorsDrizzleDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId });
});

export { apiListActorConnections };
