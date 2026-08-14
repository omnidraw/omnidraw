import { AgentProgramError, type TAgentProgramErrorCode } from '../../core/agent/service.agent';
import { CanvasAuthorityError, type TCanvasAuthorityErrorCode } from '../../core/canvas/errors';
import { CanvasDeletionError, type TCanvasDeletionErrorCode } from '../../core/canvas/service.canvas-deletion';
import { DatabaseProgramError, type TDatabaseProgramErrorCode } from '../../core/database/service.database';
import { EventProgramError, type TEventProgramErrorCode } from '../../core/events/service.events';
import { FunctionProgramError, type TFunctionProgramErrorCode } from '../../core/functions/service.functions';
import { ResourceError, toSafeResourceError } from '../../core/resources/ResourceError';
import { ResourceProgramError } from '../../core/resources/service.resources';
import type { TResourceErrorCode } from '../../core/resources/types';
import {
  WidgetStateProgramError,
  type TWidgetStateProgramErrorCode,
} from '../../core/widget-state/service.widget-state';
import { WidgetProgramError, type TWidgetProgramErrorCode } from '../../core/widgets/service.widgets';
import type { TSemanticFailureDetails } from '../../core/semantic-failure';
import { PrivateRpcError } from './private-rpc-error-schema';

export type TSemanticFailure =
  | AgentProgramError
  | CanvasAuthorityError
  | CanvasDeletionError
  | DatabaseProgramError
  | EventProgramError
  | FunctionProgramError
  | ResourceError
  | ResourceProgramError
  | WidgetProgramError
  | WidgetStateProgramError;

const AGENT_STATUS: Readonly<Record<TAgentProgramErrorCode, number>> = Object.freeze({
  AGENT_UNAVAILABLE: 503,
  CHAT_BUSY: 409,
  CHAT_CANVAS_CONFLICT: 409,
  CHAT_CANVAS_INVALID: 400,
  CHAT_CANVAS_REQUIRED: 400,
  CHAT_CANVAS_DELETING: 409,
  CHAT_CONNECTION_SUPERSEDED: 409,
  CHAT_EDIT_EMPTY: 400,
  CHAT_EDIT_TARGET_INVALID: 409,
  CHAT_REPLACEMENT_INCOMPLETE: 409,
  CHAT_SCOPE_INVALID: 404,
  CHAT_SERVICE_STOPPING: 503,
  WIDGET_REFERENCE_AMBIGUOUS: 409,
});

const CANVAS_STATUS: Readonly<Record<TCanvasAuthorityErrorCode, number>> = Object.freeze({
  NOT_FOUND: 404,
  INVALID_COMMAND: 400,
  LIMIT_EXCEEDED: 413,
  CONFLICT: 409,
  STORE_CONFLICT: 409,
  POST_COMMIT_FAILURE: 500,
  UNAVAILABLE: 503,
});

const CANVAS_DELETION_STATUS: Readonly<Record<TCanvasDeletionErrorCode, number>> = Object.freeze({
  CANVAS_DELETE_NOT_FOUND: 404,
  CANVAS_DELETE_STALE: 409,
  CANVAS_DELETE_BUSY: 409,
  CANVAS_DELETE_COORDINATION_FAILED: 503,
});

const DATABASE_STATUS: Readonly<Record<TDatabaseProgramErrorCode, number>> = Object.freeze({
  CANVAS_NOT_FOUND: 404,
  DATABASE_UNAVAILABLE: 503,
});

const EVENT_STATUS: Readonly<Record<TEventProgramErrorCode, number>> = Object.freeze({
  EVENT_CURSOR_INVALID: 409,
  EVENT_REPLAY_UNAVAILABLE: 409,
  EVENT_SUBSCRIBER_OVERFLOW: 429,
  EVENT_UNAVAILABLE: 503,
});

const FUNCTION_STATUS: Readonly<Record<TFunctionProgramErrorCode, number>> = Object.freeze({
  FUNCTION_INPUT_INVALID: 400,
  FUNCTION_INPUT_SCHEMA_INVALID: 400,
  FUNCTION_NOT_FOUND: 404,
  FUNCTION_REQUEST_INVALID: 400,
  FUNCTION_RESOURCE_UNAVAILABLE: 503,
  FUNCTION_REVISION_NOT_AVAILABLE: 404,
  FUNCTION_RUNTIME_UNAVAILABLE: 503,
  FUNCTION_UNAVAILABLE: 503,
  RESOURCE_EXHAUSTED: 429,
  WIDGET_CATALOG_CHANGED: 409,
  WIDGET_INSTANCE_ARCHIVED: 404,
  WIDGET_INSTANCE_FOREIGN: 404,
  WIDGET_INSTANCE_NOT_FOUND: 404,
  WIDGET_RESOURCE_BINDING_REQUIRED: 400,
  WIDGET_RESOURCE_BINDING_STALE: 409,
  WIDGET_RESOURCE_KIND_MISMATCH: 400,
  WIDGET_RESOURCE_NOT_READY: 503,
});

const WIDGET_STATE_STATUS: Readonly<Record<TWidgetStateProgramErrorCode, number>> = Object.freeze({
  WIDGET_STATE_CAPACITY_UNAVAILABLE: 429,
  WIDGET_STATE_UNAVAILABLE: 503,
});

const WIDGET_STATUS: Readonly<Record<TWidgetProgramErrorCode, number>> = Object.freeze({
  WIDGET_CATALOG_CHANGED: 409,
  WIDGET_CURSOR_INVALID: 409,
  WIDGET_NOT_FOUND: 404,
  WIDGET_UNAVAILABLE: 503,
});

const RESOURCE_STATUS: Readonly<Record<TResourceErrorCode, number>> = Object.freeze({
  RESOURCE_DEFINITION_NOT_FOUND: 404,
  RESOURCE_SLOT_UNKNOWN: 404,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_NAME_INVALID: 400,
  RESOURCE_NAME_CONFLICT: 409,
  RESOURCE_NAME_AMBIGUOUS: 409,
  RESOURCE_NOT_BOUND: 404,
  RESOURCE_KIND_MISMATCH: 400,
  RESOURCE_SCOPE_INVALID: 400,
  RESOURCE_NOT_READY: 503,
  RESOURCE_UNAVAILABLE: 503,
  RESOURCE_MIGRATING: 503,
  RESOURCE_READ_NOT_ALLOWED: 403,
  RESOURCE_WRITE_NOT_ALLOWED: 403,
  RESOURCE_CALL_INVALID: 400,
  RESOURCE_CALL_CANCELLED: 503,
  RESOURCE_PROVIDER_UNAVAILABLE: 503,
  RESOURCE_PLACEMENT_NOT_FOUND: 404,
  RESOURCE_PLACEMENT_STALE: 409,
  RESOURCE_LIFECYCLE_CONFLICT: 409,
  RESOURCE_DRAIN_TIMEOUT: 503,
  RESOURCE_WRITE_CAPABILITY_INVALID: 403,
  RESOURCE_WRITE_CAPABILITY_EXPIRED: 403,
  RESOURCE_WRITE_CAPABILITY_STALE: 403,
  KV_RESOURCE_NOT_BOUND: 404,
  KV_RESOURCE_UNAVAILABLE: 503,
  KV_KEY_INVALID: 400,
  KV_VALUE_INVALID: 400,
  KV_ENTRY_CONFLICT: 409,
  KV_LIST_LIMIT_EXCEEDED: 413,
  KV_WRITE_NOT_ALLOWED: 403,
  KV_OPERATION_FAILED: 503,
  SECRET_STORE_NOT_BOUND: 404,
  SECRET_STORE_UNAVAILABLE: 503,
  SECRET_STORE_KEY_UNAVAILABLE: 503,
  SECRET_STORE_DECRYPTION_FAILED: 503,
  SECRET_NAME_INVALID: 400,
  SECRET_VALUE_INVALID: 400,
  SECRET_NOT_FOUND: 404,
  SECRET_CONFLICT: 409,
  SECRET_WRITE_NOT_ALLOWED: 403,
  SECRET_OPERATION_FAILED: 503,
  DB_RESOURCE_NOT_BOUND: 404,
  DB_RESOURCE_UNAVAILABLE: 503,
  DB_RESOURCE_MIGRATING: 503,
  DB_RESOURCE_RECOVERY_FAILED: 503,
  DB_RESOURCE_DRAFT_EXISTS: 409,
  DB_RESOURCE_DRAFT_NOT_FOUND: 404,
  DB_RESOURCE_DRAFT_INVALID: 400,
  DB_RESOURCE_APPLY_IN_PROGRESS: 409,
  DB_RESOURCE_APPLY_FAILED: 503,
  DB_RESOURCE_APPLY_RECOVERED: 503,
  DB_RESOURCE_BACKUP_NOT_FOUND: 404,
  DB_RESOURCE_BACKUP_INTEGRITY_FAILED: 503,
  DB_RESOURCE_RESTORE_FAILED: 503,
  DB_RESOURCE_ROW_IDENTITY_REQUIRED: 400,
  DB_RESOURCE_ROW_CONFLICT: 409,
  DB_RESOURCE_ROW_TOO_LARGE: 413,
  DB_RESOURCE_TABLE_READ_ONLY: 403,
  DB_RESOURCE_SCHEMA_OPERATION_INVALID: 400,
  DB_NAMED_OPERATION_UNKNOWN: 404,
  DB_OPERATION_PARAMETERS_INVALID: 400,
  DB_READ_NOT_ALLOWED: 403,
  DB_WRITE_NOT_ALLOWED: 403,
  DB_ARBITRARY_SQL_NOT_ALLOWED: 403,
  DB_LIVE_SQL_APPROVAL_REQUIRED: 403,
  DB_QUERY_FAILED: 503,
  DB_EXECUTE_FAILED: 503,
  DB_RESULT_LIMIT_EXCEEDED: 413,
  DB_BUSY: 429,
  DB_RESOURCE_DELETE_FAILED: 503,
});

export function isSemanticFailure(error: unknown): error is TSemanticFailure {
  return error instanceof AgentProgramError
    || error instanceof CanvasAuthorityError
    || error instanceof CanvasDeletionError
    || error instanceof DatabaseProgramError
    || error instanceof EventProgramError
    || error instanceof FunctionProgramError
    || error instanceof ResourceError
    || error instanceof ResourceProgramError
    || error instanceof WidgetStateProgramError
    || error instanceof WidgetProgramError;
}

export function semanticFailureStatus(error: TSemanticFailure): number {
  if (error instanceof AgentProgramError) return AGENT_STATUS[(error as AgentProgramError).code];
  if (error instanceof CanvasAuthorityError) return CANVAS_STATUS[(error as CanvasAuthorityError).code];
  if (error instanceof CanvasDeletionError) return CANVAS_DELETION_STATUS[(error as CanvasDeletionError).code];
  if (error instanceof DatabaseProgramError) return DATABASE_STATUS[(error as DatabaseProgramError).code];
  if (error instanceof EventProgramError) return EVENT_STATUS[(error as EventProgramError).code];
  if (error instanceof FunctionProgramError) return FUNCTION_STATUS[(error as FunctionProgramError).code];
  if (error instanceof ResourceError) return RESOURCE_STATUS[(error as ResourceError).code];
  if (error instanceof ResourceProgramError) return RESOURCE_STATUS[(error as ResourceProgramError).code];
  if (error instanceof WidgetStateProgramError) {
    return WIDGET_STATE_STATUS[(error as WidgetStateProgramError).code];
  }
  return WIDGET_STATUS[(error as WidgetProgramError).code];
}

export type TSemanticFailureLogFields = Readonly<{
  semanticFailureTag: TSemanticFailure['_tag'];
  semanticFailureCode: TSemanticFailure['code'];
  semanticFailureStatus: number;
  semanticFailureDetails: TSemanticFailureDetails;
}>;

export function semanticFailureDetails(error: TSemanticFailure): TSemanticFailureDetails {
  if (!(error instanceof ResourceError)) return error.details;
  return toSafeResourceError(error).details ?? {};
}

export function semanticFailureLogFields(error: TSemanticFailure): TSemanticFailureLogFields {
  return Object.freeze({
    semanticFailureTag: error._tag,
    semanticFailureCode: error.code,
    semanticFailureStatus: semanticFailureStatus(error),
    semanticFailureDetails: semanticFailureDetails(error),
  });
}

export function semanticFailureToPrivateRpcError(error: TSemanticFailure): PrivateRpcError {
  return new PrivateRpcError({
    code: error.code,
    status: semanticFailureStatus(error),
    message: error.message,
    details: semanticFailureDetails(error),
  });
}
