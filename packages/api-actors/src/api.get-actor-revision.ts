import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanRegisterActorRevision, fxGetActorRevision } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiGetActorRevision = baseActorsOs.revisions.get.handler(async ({ input, context }) => {
  if (!fxCanRegisterActorRevision({ db: getActorsDrizzleDb(context.db) }, { accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot get actor revision' });
  }

  return fxGetActorRevision({ db: getActorsDrizzleDb(context.db) }, { id: input.id });
});

export { apiGetActorRevision };
