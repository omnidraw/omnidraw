import { baseWidgetOs } from './procedure-builder';
import { widgetStateIdentity } from './widget-state-identity';

const apiRuntimeWidgetStateChange = baseWidgetOs.runtime.state.change.handler(
  ({ context, input }) => context.widgetState.change({
    identity: widgetStateIdentity(input),
    expectedVersion: input.expectedVersion,
    state: input.state,
  }),
);

export { apiRuntimeWidgetStateChange };
