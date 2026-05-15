import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanRegisterActorRevision, fxListActorRevisions } from './fx.actor-db';
import { baseActorsOs } from './orpc';

const apiListActorRevisions = baseActorsOs.revisions.list.handler(async ({ input, context }) => {
  if (!fxCanRegisterActorRevision({ db: getActorsDrizzleDb(context.db) }, { accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot list actor revisions' });
  }

  return fxListActorRevisions({ db: getActorsDrizzleDb(context.db) }, input);
});

export { apiListActorRevisions };
