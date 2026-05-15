import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanViewCanvas, fxListActorInstances } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiListActorInstances = baseActorsOs.instances.list.handler(async ({ input, context }) => {
  if (!fxCanViewCanvas({ db: getActorsDrizzleDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'No access to canvas actor instances' });
  }

  return fxListActorInstances({ db: getActorsDrizzleDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId });
});

export { apiListActorInstances };
