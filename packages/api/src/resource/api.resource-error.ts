import { ORPCError } from '@orpc/contract';
import { toSafeResourceError } from '@vibecanvas/resource-runtime';

export async function withResourceApiError<T>(operation: () => T): Promise<Awaited<T>> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    const safe = toSafeResourceError(error);
    throw new ORPCError('RESOURCE_ERROR', {
      message: safe.message,
      data: {
        code: safe.code,
        ...(safe.details === undefined ? {} : { details: safe.details }),
      },
    });
  }
}
