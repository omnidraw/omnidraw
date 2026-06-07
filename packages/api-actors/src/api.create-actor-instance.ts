import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanEditCanvas } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txCreateActorInstance } from './tx.actor-db';

const apiCreateActorInstance = baseActorsOs.instances.create.handler(async ({ input, context }) => {
  if (!(await fxCanEditCanvas({ db: getActorsDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId }))) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot create actor instance on this canvas' });
  }

  const instance = await txCreateActorInstance({
    db: getActorsDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { input, accountId: context.accountId });

  if (!instance) throw new ORPCError('NOT_FOUND', { message: 'Actor definition not found' });
  await context.actor?.bootInstance({ actorInstanceId: instance.id });
  return instance;
});

export { apiCreateActorInstance };
