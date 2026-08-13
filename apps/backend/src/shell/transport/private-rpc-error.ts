import { ProcedureError } from '../api/procedure';
import {
  isSemanticFailure,
  semanticFailureDetails,
  semanticFailureStatus,
} from './semantic-failure';
import { PrivateRpcError, PrivateWireValue } from './private-rpc-error-schema';

export { PrivateRpcError, PrivateWireValue } from './private-rpc-error-schema';

/** The bounded private transport failure policy shared by every operation. */
export function privateRpcError(error: unknown): PrivateRpcError {
  if (error instanceof PrivateRpcError) return error;
  if (isSemanticFailure(error)) {
    return new PrivateRpcError({
      code: error.code,
      status: semanticFailureStatus(error),
      message: error.message,
      details: semanticFailureDetails(error),
    });
  }
  if (error instanceof ProcedureError) {
    return new PrivateRpcError({
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.data ?? null,
    });
  }
  return new PrivateRpcError({
    code: 'INTERNAL_SERVER_ERROR',
    status: 500,
    message: 'The backend could not complete this operation.',
    details: null,
  });
}
