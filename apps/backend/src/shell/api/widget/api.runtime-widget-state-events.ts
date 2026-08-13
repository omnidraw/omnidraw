import { ProcedureError } from '../procedure';
import { baseWidgetOs } from './procedure-builder';
import { widgetStateIdentity } from './widget-state-identity';

const apiRuntimeWidgetStateEvents = baseWidgetOs.runtime.state.events.handler(
  async function* ({ context, input }) {
    const identity = widgetStateIdentity(input);
    const result = await context.widgetState.subscribe({
      identity,
      afterVersion: input.afterVersion,
    });
    if (result.status === 'capacity-unavailable') {
      throw new ProcedureError('TOO_MANY_REQUESTS', {
        message: 'Widget state subscription capacity is exhausted.',
      });
    }
    if (result.status === 'unavailable') {
      throw new ProcedureError('NOT_FOUND', {
        message: 'Widget state target was not found.',
      });
    }
    yield* result.events;
  },
);

export { apiRuntimeWidgetStateEvents };
