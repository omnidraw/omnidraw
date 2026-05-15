import { ORPCError } from '@orpc/server';
import { getActorsDrizzleDb } from './db';
import { fxCanRegisterActorRevision } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import { txRegisterActorRevision } from './tx.actor-db';

const apiRegisterActorRevision = baseActorsOs.revisions.register.handler(async ({ input, context }) => {
  if (!fxCanRegisterActorRevision({ db: getActorsDrizzleDb(context.db) }, { accountId: context.accountId })) {
    throw new ORPCError('FORBIDDEN', { message: 'Cannot register actor revisions' });
  }

  return txRegisterActorRevision({
    db: getActorsDrizzleDb(context.db),
    eventPublisher: context.eventPublisher,
    createId: () => crypto.randomUUID(),
  }, { input, accountId: context.accountId });
});

export { apiRegisterActorRevision };
