import { ORPCError } from '@orpc/contract';
import { toSafeActorResourceError } from '@vibecanvas/service-actor/resources/ActorResourceError';

export async function withActorResourceApiError<T>(operation: () => T): Promise<Awaited<T>> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    const safe = toSafeActorResourceError(error);
    throw new ORPCError('ACTOR_RESOURCE_ERROR', {
      message: safe.message,
      data: {
        code: safe.code,
        ...(safe.details === undefined ? {} : { details: safe.details }),
      },
    });
  }
}
