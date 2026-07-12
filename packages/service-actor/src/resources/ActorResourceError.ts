export type TActorResourceErrorCode =
  | 'RESOURCE_DEFINITION_NOT_FOUND'
  | 'RESOURCE_SLOT_UNKNOWN'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_NOT_BOUND'
  | 'RESOURCE_KIND_MISMATCH'
  | 'RESOURCE_SCHEMA_MISMATCH'
  | 'RESOURCE_VERSION_MISMATCH'
  | 'RESOURCE_SCOPE_INVALID'
  | 'RESOURCE_STILL_BOUND'
  | 'RESOURCE_NOT_READY'
  | 'RESOURCE_UNAVAILABLE'
  | 'RESOURCE_MIGRATING'
  | 'RESOURCE_READ_NOT_ALLOWED'
  | 'RESOURCE_WRITE_NOT_ALLOWED'
  | 'RESOURCE_CALL_CANCELLED'
  | 'RESOURCE_PROVIDER_UNAVAILABLE'
  | 'KV_RESOURCE_NOT_BOUND'
  | 'KV_RESOURCE_UNAVAILABLE'
  | 'KV_KEY_INVALID'
  | 'KV_VALUE_INVALID'
  | 'KV_ENTRY_CONFLICT'
  | 'KV_LIST_LIMIT_EXCEEDED'
  | 'KV_WRITE_NOT_ALLOWED'
  | 'KV_OPERATION_FAILED'
  | 'SECRET_STORE_NOT_BOUND'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'SECRET_NAME_INVALID'
  | 'SECRET_VALUE_INVALID'
  | 'SECRET_NOT_FOUND'
  | 'SECRET_CONFLICT'
  | 'SECRET_WRITE_NOT_ALLOWED'
  | 'SECRET_OPERATION_FAILED'
  | 'DB_RESOURCE_NOT_BOUND'
  | 'DB_RESOURCE_UNAVAILABLE'
  | 'DB_RESOURCE_SCHEMA_MISMATCH'
  | 'DB_RESOURCE_VERSION_MISMATCH'
  | 'DB_RESOURCE_MIGRATING'
  | 'DB_RESOURCE_MIGRATION_CHANGED'
  | 'DB_RESOURCE_MIGRATION_FAILED'
  | 'DB_RESOURCE_RECOVERY_FAILED'
  | 'DB_NAMED_OPERATION_UNKNOWN'
  | 'DB_OPERATION_PARAMETERS_INVALID'
  | 'DB_READ_NOT_ALLOWED'
  | 'DB_WRITE_NOT_ALLOWED'
  | 'DB_ARBITRARY_SQL_NOT_ALLOWED'
  | 'DB_QUERY_FAILED'
  | 'DB_EXECUTE_FAILED'
  | 'DB_RESULT_LIMIT_EXCEEDED'
  | 'DB_BUSY'
  | 'DB_RESOURCE_DELETE_FAILED';

export class ActorResourceError extends Error {
  readonly code: TActorResourceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: TActorResourceErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ActorResourceError';
    this.code = code;
    this.details = details;
  }
}

export function toActorResourceError(error: unknown, fallbackCode: TActorResourceErrorCode, fallbackMessage: string): ActorResourceError {
  if (error instanceof ActorResourceError) return error;
  return new ActorResourceError(fallbackCode, fallbackMessage);
}

const SENSITIVE_DETAIL_KEY = /(?:credential|parameter|password|path|secret|sql|token|value)/i;

function safeDetailValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'object' || seen.has(value)) return undefined;

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => safeDetailValue(item, seen)).filter((item) => item !== undefined);
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_DETAIL_KEY.test(key)) continue;
      const safe = safeDetailValue(item, seen);
      if (safe !== undefined) result[key] = safe;
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function toSafeActorResourceError(error: unknown): {
  readonly code: TActorResourceErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
} {
  if (!(error instanceof ActorResourceError)) {
    return { code: 'RESOURCE_PROVIDER_UNAVAILABLE', message: 'Actor resource call failed.' };
  }
  const details = error.details === undefined
    ? undefined
    : safeDetailValue(error.details, new Set()) as Record<string, unknown> | undefined;
  return {
    code: error.code,
    message: error.message,
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}
