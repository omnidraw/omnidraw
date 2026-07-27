import { baseWidgetOs } from './orpc';
import { widgetStateIdentity } from './widget-state-identity';

const apiRuntimeWidgetStateChange = baseWidgetOs.runtime.state.change.handler(
  ({ context, input }) => context.widgetState.change(context.tenant, {
    identity: widgetStateIdentity(context.tenant, input),
    expectedVersion: input.expectedVersion,
    state: input.state,
  }),
);

export { apiRuntimeWidgetStateChange };
