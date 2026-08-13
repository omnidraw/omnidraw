import { Schema } from 'effect';
import { AgentServiceError } from '../../core/agent/error.agent-service';
import { AgentProgramError } from '../../core/agent/service.agent';
import { CanvasAuthorityError } from '../../core/canvas/errors';
import { EventProgramError } from '../../core/events/service.events';
import { FunctionProgramError } from '../../core/functions/service.functions';
import { ResourceProgramError } from '../../core/resources/service.resources';
import { WidgetStateProgramError } from '../../core/widget-state/service.widget-state';
import { ProcedureError } from '../api/procedure';

export const PrivateWireValue = Schema.Json;

export class PrivateRpcError extends Schema.TaggedError<PrivateRpcError>()(
  'PrivateRpcError',
  {
    code: Schema.String,
    status: Schema.Number,
    message: Schema.String,
    details: PrivateWireValue,
  },
) {}

/** The bounded private transport failure policy shared by every operation. */
export function privateRpcError(error: unknown): PrivateRpcError {
  if (error instanceof PrivateRpcError) return error;
  if (error instanceof AgentServiceError) {
    return new PrivateRpcError({
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
    });
  }
  if (
    error instanceof AgentProgramError
    || error instanceof EventProgramError
    || error instanceof FunctionProgramError
    || error instanceof ResourceProgramError
    || error instanceof WidgetStateProgramError
  ) {
    return new PrivateRpcError({
      code: error.code,
      status: error.code.includes('NOT_FOUND') ? 404
        : error.code.includes('CAPACITY') ? 429
          : error.code.includes('CONFLICT') || error.code.includes('CHANGED') ? 409
            : 500,
      message: error.message,
      details: null,
    });
  }
  if (error instanceof CanvasAuthorityError) {
    const status = error.code === 'NOT_FOUND'
      ? 404
      : error.code === 'INVALID_COMMAND'
        ? 400
        : error.code === 'LIMIT_EXCEEDED'
          ? 413
          : error.code === 'CONFLICT' || error.code === 'STORE_CONFLICT'
            ? 409
            : error.code === 'UNAVAILABLE'
              ? 503
              : 500;
    return new PrivateRpcError({
      code: error.code,
      status,
      message: error.message,
      details: error.details,
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
