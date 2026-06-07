import { ORPCError } from '@orpc/server';
import { getActorsDb } from './db';
import { fxCanViewCanvas, fxListActorConnections, fxListActorInstances } from './fx.actor-db';
import { baseActorsOs } from './orpc';
import type { TActorEvent } from './contract';

const apiActorEvents = baseActorsOs.events.handler(async function* ({ input, context }) {
  if (!(await fxCanViewCanvas({ db: getActorsDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId }))) {
    throw new ORPCError('FORBIDDEN', { message: 'No access to canvas actor events' });
  }

  yield {
    type: 'actor.snapshot' as const,
    canvasId: input.canvasId,
    instances: await fxListActorInstances({ db: getActorsDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId }),
    connections: await fxListActorConnections({ db: getActorsDb(context.db) }, { canvasId: input.canvasId, accountId: context.accountId }),
  };

  for await (const event of context.eventPublisher.subscribeActorEvents(input.canvasId)) {
    yield event as TActorEvent;
  }
});

export { apiActorEvents };
