import { ORPCError } from '@orpc/contract';
import { baseWidgetOs } from './orpc';
import { widgetStateIdentity } from './widget-state-identity';

const apiRuntimeWidgetStateEvents = baseWidgetOs.runtime.state.events.handler(
  async function* ({ context, input }) {
    const identity = widgetStateIdentity(context.tenant, input);
    const result = await context.widgetState.subscribe(context.tenant, {
      identity,
      afterVersion: input.afterVersion,
    });
    if (result.status === 'capacity-unavailable') {
      throw new ORPCError('TOO_MANY_REQUESTS', {
        message: 'Widget state subscription capacity is exhausted.',
      });
    }
    if (result.status === 'unavailable') {
      throw new ORPCError('NOT_FOUND', {
        message: 'Widget state target was not found.',
      });
    }
    yield* result.events;
  },
);

export { apiRuntimeWidgetStateEvents };
