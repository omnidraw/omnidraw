import { baseWidgetOs } from './orpc';
import { widgetStateIdentity } from './widget-state-identity';

const apiRuntimeWidgetStateGet = baseWidgetOs.runtime.state.get.handler(
  ({ context, input }) => context.widgetState.get({
    identity: widgetStateIdentity(input),
  }),
);

export { apiRuntimeWidgetStateGet };
