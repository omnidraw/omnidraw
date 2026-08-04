import { baseFunctionOs } from './orpc';
import { withFunctionApiError } from './api.function-error';

const apiInvokeFunction = baseFunctionOs.invoke.handler(({ context, input, signal }) => (
  withFunctionApiError(() => context.functionInvocation.invokeFunction(input, signal))
));

export { apiInvokeFunction };
