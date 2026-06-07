import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanViewCanvas, fxGetActorInstance } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiGetActorInstance = baseActorsOs.instances.get.handler(async ({ input, context }) => {
  const instance = await fxGetActorInstance({ db: getActorsDb(context.db) }, { id: input.id });
  if (!instance) return null;

  if (!(await fxCanViewCanvas({ db: getActorsDb(context.db) }, { canvasId: instance.canvas_id, accountId: context.accountId }))) {
    throw new ORPCError('FORBIDDEN', { message: 'No access to actor instance' });
  }

  return instance;
});

export { apiGetActorInstance };
