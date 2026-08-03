declare global {
  const OMNIDRAW_COMPILED: boolean | undefined;
  const OMNIDRAW_VERSION: string | undefined;

  /**
   * Error code prefix indicating which layer the error originated from.
   * - FN: Pure functions (synchronous, no I/O)
   * - FX: Effectful functions (async, reads)
   * - TX: Transaction functions (async, writes with rollback)
   * - CTRL: Controllers (orchestration)
   * - API: API handlers (HTTP layer)
   */
  type TErrorPrefix = 'FN' | 'FX' | 'TX' | 'CTRL' | 'API' | 'SRV' | 'CLI';

  /**
   * Error code pattern: PREFIX.MODULE.NAME.ERROR (all uppercase after prefix)
   * Examples:
   * - "FN.PROJECT.GENERATE_CONFIG.INVALID_NAME"
   * - "TX.USER.CREATE.FAILED"
   * - "CTRL.META.CREATE_FUNCTION.INVALID_NAME"
   *
   * Each package defines its own error codes as constants.
   */
  type TErrorCode = `${TErrorPrefix}.${string}.${string}.${string}`;

  type TLang = "en" | "de" | "fr" | "es" | "it" | "pt" | "ru" | "zh" | "ja" | "ko" | "ar" | "hi" | "bn" | "id" | "ms" | "th" | "vi" | "tr" | "nl" | "pl" | "uk" | "cs" | "hu" | "ro" | "sv" | "da" | "fi" | "no" | "el" | "he" | "fa";

  type TErrorStatus = 400 | 401 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 422 | 423 | 424 | 426 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;

  type THandleBarsTemplate = string;

  /**
   * Explaination:
   *
   * This error object can be mapped for internal and external communcation.
   * The inner layer must return a TErrorEntry and the outer layer decided
   * use this for e.g. http status, multi lang message or internal logging
   * The messages are handlebars templates and will if present use text replacement before logging
   * It is important to seperate error messages going to users and internal developers.
   * Never expose internal implementation details to the user.
   *
   * code: string; Unique identifier for the error code use dot notation to indicate the module and the function that caused the error. E.g. "FN.ON_START_CHECKS.MISSING_SERVER_FILE"
   * handlebarsParams?: Record<string, string>; Optional parameters to be used in the error message. Text replacement look search for "my error message: {{param1}} {{param2}}"
   * externalMessage?: Partial<Record<TLang, THandleBarsTemplate>> & { "en": THandleBarsTemplate }; The error message to be displayed to the user. Must be written in a way that is easy to understand and does not expose any internal implementation details.
   * internalMessage?: THandleBarsTemplate; The error message to be displayed to the developer. Can contain internal implementation details.
   * shouldLogInternally?: boolean; If true, the error will be logged internally
   * internalMetadata?: Record<string, string>; Optional metadata. Not for handlebars replacement. Think appId, userId
   * internalLogLevel?: "error" | "warn" | "info" | "debug"; The log level to use when logging internally. Defaults to "error"
   * needsInspection?: boolean; Hint for internal developers to inspect the error and take action.
   */
  type TErrorEntry = {
    code: TErrorCode;
    statusCode: TErrorStatus;
    handlebarsParams?: Record<string, string>;
    externalMessage?: Partial<Record<TLang, THandleBarsTemplate>> & { "en": THandleBarsTemplate };
    internalMessage?: THandleBarsTemplate;
    shouldLogInternally?: boolean;
    internalMetadata?: Record<string, string>;
    internalLogLevel?: "error" | "warn" | "info" | "debug";
    needsInspection?: boolean;
  }

  /**
   * A fn[] that can be used to rollback an external action.
   * Like deleting a neon project, refunding a PayPal charge, or deleting a github repo.
   *
   * Use cases:
   * - External API calls (PayPal refunds, Stripe cancellations, S3 deletions)
   * - Remote service operations (Neon project deletion, GitHub repo removal)
   * - Any write operation that can't be part of a DB transaction
   *
   * In rare cases the rollback might fail and return its own rollback function.
   * On success the rollback function returns a loggable string describing what was undone.
   *
   * For database atomicity, pass a transaction object via TPortal and let the
   * controller commit/rollback. TExternalRollback is for non-DB side effects only.
   *
   * Note: Rollbacks are executed sequentially in reverse order via executeRollbacks().
   */
  type TExternalRollback = () => Promise<TErrTriple<string>>;

  type TErrTuple<T> = [value: T, error: null] | [value: null, error: TErrorEntry];
  /**
   * Every effectful function should return a TErrTriple.
   * No Rollback should be internally executed.
   * The caller is responsible for executing the rollbacks in reverse order.
   */
  type TErrTriple<T> = [value: T, error: null, rollbacks: TExternalRollback[]] | [value: null, error: TErrorEntry, rollbacks: TExternalRollback[]];
}

// This empty export makes TypeScript happy - confirms it's a module
export {};
