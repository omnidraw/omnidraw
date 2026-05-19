import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanListActorDefinitions, fxListActorDefinitions } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiListActorDefinitions = baseActorsOs.definitions.list.handler(async ({ input, context }) => {
  if (!fxCanListActorDefinitions({ db: getActorsDrizzleDb(context.db) }, { accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot list actor definitions' });
  }

  return fxListActorDefinitions({ db: getActorsDrizzleDb(context.db) }, input ?? {});
});

export { apiListActorDefinitions };
