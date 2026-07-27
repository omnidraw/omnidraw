import { ORPCError } from '@orpc/contract';
import { baseFunctionOs } from './orpc';
import { withFunctionApiError } from './api.function-error';

const apiGetFunction = baseFunctionOs.get.handler(async ({ context, input }) => {
  const invocation = await withFunctionApiError(() => (
    context.functionInvocation.getFunctionInvocation(context.tenant, input.invocationId)
  ));
  if (invocation === null) throw new ORPCError('NOT_FOUND', { message: 'Function invocation not found.' });
  return invocation;
});

export { apiGetFunction };
