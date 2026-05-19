import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanListActorDefinitions, fxGetActorDefinition } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiGetActorDefinition = baseActorsOs.definitions.get.handler(async ({ input, context }) => {
  if (!fxCanListActorDefinitions({ db: getActorsDrizzleDb(context.db) }, { accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot get actor definition' });
  }

  return fxGetActorDefinition({ db: getActorsDrizzleDb(context.db) }, { id: input.id });
});

export { apiGetActorDefinition };
