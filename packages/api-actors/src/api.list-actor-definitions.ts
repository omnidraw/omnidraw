import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanListActorDefinitions, fxListActorDefinitions } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiListActorDefinitions = baseActorsOs.definitions.list.handler(async ({ input, context }) => {
  if (!(await fxCanListActorDefinitions({ db: getActorsDb(context.db) }, { accountId: context.accountId }))) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot list actor definitions' });
  }

  return await fxListActorDefinitions({ db: getActorsDb(context.db) }, input ?? {});
});

export { apiListActorDefinitions };
