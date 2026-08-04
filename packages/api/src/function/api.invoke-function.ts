import { baseFunctionOs } from './orpc';
import { withFunctionApiError } from './api.function-error';

const apiInvokeFunction = baseFunctionOs.invoke.handler(({ context, input, signal }) => (
  withFunctionApiError(() => context.functionInvocation.invokeFunction(context.tenant, input, signal))
));

export { apiInvokeFunction };
