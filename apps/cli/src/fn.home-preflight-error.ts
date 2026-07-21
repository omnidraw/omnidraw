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

function fnBuildHomePreflightError(args: TArgs): THomePreflightError {
  const reason = args.error instanceof Error ? args.error.message : String(args.error);

  return {
    ok: false,
    command: 'serve',
    code: 'VIBECANVAS_HOME_PREFLIGHT_FAILED',
    message: `Refusing selected Vibecanvas home '${args.homeDir}': ${reason}`,
    hint: 'Actor-era and unknown non-empty layouts are unsupported. The selected home was not modified.',
    next: `Archive or move '${args.homeDir}' manually, or retry with --data-dir <fresh-path>.`,
  };
}

export { fnBuildHomePreflightError };
export type { THomePreflightError };
