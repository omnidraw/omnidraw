import { ProcedureError } from '../procedure';
import { toSafeResourceError } from '#backend/shell/resources';

export async function withResourceApiError<T>(operation: () => T): Promise<Awaited<T>> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProcedureError) throw error;
    const safe = toSafeResourceError(error);
    throw new ProcedureError('RESOURCE_ERROR', {
      message: safe.message,
      data: {
        code: safe.code,
        ...(safe.details === undefined ? {} : { details: safe.details }),
      },
    });
  }
}
