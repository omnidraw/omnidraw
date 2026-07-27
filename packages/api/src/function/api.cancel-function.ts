import { ORPCError } from '@orpc/contract';
import { baseFunctionOs } from './orpc';
import { withFunctionApiError } from './api.function-error';

const apiCancelFunction = baseFunctionOs.cancel.handler(async ({ context, input }) => {
  const invocation = await withFunctionApiError(() => (
    context.functionInvocation.cancelFunctionInvocation(context.tenant, input.invocationId)
  ));
  if (invocation === null) throw new ORPCError('NOT_FOUND', { message: 'Function invocation not found.' });
  return invocation;
});

export { apiCancelFunction };
