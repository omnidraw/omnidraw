import { ORPCError } from '@orpc/contract';

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

/** Maps domain failures to stable, path-free public errors. */
export async function withFunctionApiError<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = errorCode(error);
    if (
      code === 'FUNCTION_INPUT_INVALID'
      || code === 'FUNCTION_INPUT_SCHEMA_INVALID'
      || code === 'FUNCTION_REQUEST_INVALID'
    ) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'Function input does not match the published schema.',
      });
    }
    if (
      code === 'WIDGET_INSTANCE_NOT_FOUND'
      || code === 'WIDGET_INSTANCE_FOREIGN'
      || code === 'WIDGET_INSTANCE_ARCHIVED'
      || code === 'FUNCTION_NOT_FOUND'
      || code === 'FUNCTION_REVISION_NOT_AVAILABLE'
    ) {
      throw new ORPCError('NOT_FOUND', { message: 'Function invocation target not found.' });
    }
    if (code === 'IDEMPOTENCY_CONFLICT') {
      throw new ORPCError('CONFLICT', {
        message: 'Idempotency key was already used for a different invocation.',
      });
    }
    if (
      code === 'FUNCTION_CANCELLATION_CONFLICT'
      || code === 'FUNCTION_ALREADY_TERMINAL'
    ) {
      throw new ORPCError('CONFLICT', { message: 'Function invocation cannot be cancelled.' });
    }
    if (
      code === 'FUNCTION_UNAVAILABLE'
      || code === 'FUNCTION_RUNTIME_UNAVAILABLE'
      || code === 'FUNCTION_RESOURCE_UNAVAILABLE'
    ) {
      throw new ORPCError('SERVICE_UNAVAILABLE', {
        message: 'Function execution is temporarily unavailable.',
      });
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Function invocation operation failed.',
    });
  }
}
