export type TAgentServiceErrorCode =
  | 'CHAT_BUSY'
  | 'CHAT_CANVAS_CONFLICT'
  | 'CHAT_CANVAS_INVALID'
  | 'CHAT_CANVAS_REQUIRED'
  | 'CHAT_CONNECTION_SUPERSEDED'
  | 'CHAT_EDIT_EMPTY'
  | 'CHAT_EDIT_TARGET_INVALID'
  | 'CHAT_REPLACEMENT_INCOMPLETE'
  | 'CHAT_SCOPE_INVALID'
  | 'CHAT_SERVICE_STOPPING'
  | 'WIDGET_REFERENCE_AMBIGUOUS';

const STATUS_BY_CODE: Readonly<Record<TAgentServiceErrorCode, number>> = Object.freeze({
  CHAT_BUSY: 409,
  CHAT_CANVAS_CONFLICT: 409,
  CHAT_CANVAS_INVALID: 400,
  CHAT_CANVAS_REQUIRED: 400,
  CHAT_CONNECTION_SUPERSEDED: 409,
  CHAT_EDIT_EMPTY: 400,
  CHAT_EDIT_TARGET_INVALID: 409,
  CHAT_REPLACEMENT_INCOMPLETE: 409,
  CHAT_SCOPE_INVALID: 404,
  CHAT_SERVICE_STOPPING: 503,
  WIDGET_REFERENCE_AMBIGUOUS: 409,
});

/** Expected agent/chat failure preserved across application transports. */
export class AgentServiceError extends Error {
  readonly code: TAgentServiceErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: TAgentServiceErrorCode,
    message: string,
    details: unknown = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AgentServiceError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
