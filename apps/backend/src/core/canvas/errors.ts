export type TCanvasAuthorityErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_COMMAND'
  | 'LIMIT_EXCEEDED'
  | 'CONFLICT'
  | 'STORE_CONFLICT'
  | 'POST_COMMIT_FAILURE'
  | 'UNAVAILABLE';

export class CanvasAuthorityError extends Error {
  readonly _tag = 'CanvasAuthorityError';
  readonly code: TCanvasAuthorityErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: TCanvasAuthorityErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CanvasAuthorityError';
    this.code = code;
    this.details = details;
  }
}
