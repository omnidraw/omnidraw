export type TActorResourceErrorCode =
  | 'RESOURCE_DEFINITION_NOT_FOUND'
  | 'RESOURCE_SLOT_UNKNOWN'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_NAME_INVALID'
  | 'RESOURCE_NAME_CONFLICT'
  | 'RESOURCE_NAME_AMBIGUOUS'
  | 'RESOURCE_NOT_BOUND'
  | 'RESOURCE_KIND_MISMATCH'
  | 'RESOURCE_SCOPE_INVALID'
  | 'RESOURCE_BINDING_CONFLICT'
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
  | 'SECRET_STORE_KEY_UNAVAILABLE'
  | 'SECRET_STORE_DECRYPTION_FAILED'
  | 'SECRET_NAME_INVALID'
  | 'SECRET_VALUE_INVALID'
  | 'SECRET_NOT_FOUND'
  | 'SECRET_CONFLICT'
  | 'SECRET_WRITE_NOT_ALLOWED'
  | 'SECRET_OPERATION_FAILED'
  | 'DB_RESOURCE_NOT_BOUND'
  | 'DB_RESOURCE_UNAVAILABLE'
  | 'DB_RESOURCE_MIGRATING'
  | 'DB_RESOURCE_RECOVERY_FAILED'
  | 'DB_RESOURCE_DRAFT_EXISTS'
  | 'DB_RESOURCE_DRAFT_NOT_FOUND'
  | 'DB_RESOURCE_DRAFT_INVALID'
  | 'DB_RESOURCE_APPLY_IN_PROGRESS'
  | 'DB_RESOURCE_APPLY_FAILED'
  | 'DB_RESOURCE_APPLY_RECOVERED'
  | 'DB_RESOURCE_RESTORE_FAILED'
  | 'DB_RESOURCE_ROW_IDENTITY_REQUIRED'
  | 'DB_RESOURCE_ROW_CONFLICT'
  | 'DB_RESOURCE_ROW_TOO_LARGE'
  | 'DB_RESOURCE_TABLE_READ_ONLY'
  | 'DB_RESOURCE_SCHEMA_OPERATION_INVALID'
  | 'DB_NAMED_OPERATION_UNKNOWN'
  | 'DB_OPERATION_PARAMETERS_INVALID'
  | 'DB_READ_NOT_ALLOWED'
  | 'DB_WRITE_NOT_ALLOWED'
  | 'DB_ARBITRARY_SQL_NOT_ALLOWED'
  | 'DB_LIVE_SQL_APPROVAL_REQUIRED'
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
  const coded = error as { code?: unknown; message?: unknown };
  if (
    (coded?.code === 'RESOURCE_NAME_INVALID' || coded?.code === 'RESOURCE_NAME_CONFLICT' || coded?.code === 'RESOURCE_BINDING_CONFLICT')
    && typeof coded.message === 'string'
  ) {
    return new ActorResourceError(coded.code, coded.message);
  }
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
