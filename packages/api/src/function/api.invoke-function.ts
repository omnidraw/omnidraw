import { baseFunctionOs } from './orpc';
import { withFunctionApiError } from './api.function-error';

const apiInvokeFunction = baseFunctionOs.invoke.handler(({ context, input }) => (
  withFunctionApiError(() => context.functionInvocation.invokeFunction(context.tenant, input))
));

export { apiInvokeFunction };
