import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanViewCanvas, fxGetActorInstance, fxListActorOutputs } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiListActorOutputs = baseActorsOs.outputs.list.handler(async ({ input, context }) => {
  const db = getActorsDb(context.db);
  const instance = await fxGetActorInstance({ db }, { id: input.actorInstanceId });
  if (!instance) throw new ORPCError('NOT_FOUND', { message: 'Actor instance not found' });

  if (!(await fxCanViewCanvas({ db }, { canvasId: instance.canvas_id, accountId: context.accountId }))) {
    throw new ORPCError('FORBIDDEN', { message: 'No access to actor outputs' });
  }

  return await fxListActorOutputs({ db }, input);
});

export { apiListActorOutputs };
