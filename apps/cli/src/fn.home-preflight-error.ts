type TArgs = {
  homeDir: string;
  error: unknown;
};

type THomePreflightError = {
  ok: false;
  command: 'serve';
  code: 'VIBECANVAS_HOME_PREFLIGHT_FAILED';
  message: string;
  hint: string;
  next: string;
};

type TErrorLike = {
  cause?: unknown;
  message?: unknown;
};

function fnErrorLike(value: unknown): TErrorLike | undefined {
  return typeof value === 'object' && value !== null ? value as TErrorLike : undefined;
}

function fnErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const visited: unknown[] = [];
  let current: unknown = error;

  while (current !== undefined && current !== null && !visited.includes(current)) {
    visited.push(current);
    const errorLike = fnErrorLike(current);
    const message = typeof errorLike?.message === 'string'
      ? errorLike.message.trim()
      : typeof current === 'string'
        ? current.trim()
        : '';
    if (message && messages.at(-1) !== message) messages.push(message);
    current = errorLike?.cause;
  }

  if (messages.length > 0) return messages;
  return [String(error)];
}

function fnIsDatabaseLockReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes('already open')
    || normalized.includes('database is locked')
    || normalized.includes('database locked')
    || normalized.includes('lock conflict')
    || normalized.includes('sqlite_busy')
  );
}

function fnIsSchemaOrLayoutReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  if (
    normalized.includes('unknown database')
    || normalized.includes('unknown non-empty')
    || normalized.includes('checksum')
    || normalized.includes('schema manifest')
    || normalized.includes('application_id')
    || normalized.includes('user_version')
  ) {
    return true;
  }

  return (
    normalized.startsWith('refusing ')
    && !normalized.includes('after a read-only preflight failed')
  );
}

function fnBuildHomePreflightError(args: TArgs): THomePreflightError {
  const reasons = fnErrorMessages(args.error);
  const reason = reasons.at(-1) ?? 'Unknown database preflight failure.';
  const isDatabaseLock = reasons.some(fnIsDatabaseLockReason);
  const isSchemaOrLayoutRefusal = !isDatabaseLock && reasons.some(fnIsSchemaOrLayoutReason);

  const guidance = isDatabaseLock
    ? {
        hint: 'The database is already open or locked by another process. The selected home was not modified.',
        next: 'Stop the other process using this Vibecanvas home, or retry with --data-dir <separate-path>.',
      }
    : isSchemaOrLayoutRefusal
      ? {
          hint: 'Unknown or incompatible database layouts are unsupported. The selected home was not modified.',
          next: `Archive or move '${args.homeDir}' manually, or retry with --data-dir <fresh-path>.`,
        }
      : {
          hint: `The selected home was not modified. Database preflight reason: ${reason}`,
          next: 'Resolve the reported database error, or retry with --data-dir <separate-path>.',
        };

  return {
    ok: false,
    command: 'serve',
    code: 'VIBECANVAS_HOME_PREFLIGHT_FAILED',
    message: `Refusing selected Vibecanvas home '${args.homeDir}': ${reason}`,
    ...guidance,
  };
}

export { fnBuildHomePreflightError };
export type { THomePreflightError };
