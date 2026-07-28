const SENSITIVE_ENVIRONMENT_NAME =
  /(?:AUTH|COOKIE|CREDENTIAL|DATABASE_URL|DSN|KEY|PASS|PRIVATE|SECRET|SESSION|TOKEN)/iu;
const SAFE_PROCESS_ENVIRONMENT_NAMES = Object.freeze([
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_EXTRA_CA_CERTS',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
] as const);
const SAFE_WINDOWS_PROCESS_ENVIRONMENT_NAMES = Object.freeze([
  'ComSpec',
  'PATHEXT',
  'SystemRoot',
  'WINDIR',
] as const);

function fnReplaceAll(value: string, needle: string): string {
  return needle.length === 0 ? value : value.split(needle).join('[redacted]');
}

/**
 * Redacts ambient credentials and common authentication syntax from bounded
 * guest process output before it can become a user- or model-visible diagnostic.
 */
export function fnRedactBuildOutput(
  value: string,
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const sensitiveValues = [...new Set(
    Object.entries(environment)
      .filter(([name, secret]) => (
        SENSITIVE_ENVIRONMENT_NAME.test(name)
        && typeof secret === 'string'
        && secret.length >= 4
        && secret.length <= 16_384
      ))
      .map(([, secret]) => secret as string),
  )].sort((left, right) => right.length - left.length);

  let redacted = value;
  for (const secret of sensitiveValues) {
    redacted = fnReplaceAll(redacted, secret);
  }
  return redacted
    .replace(
      /\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      '$1[redacted]@',
    )
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu,
      '$1 [redacted]',
    )
    .replace(
      /\b((?:_authToken|api[_-]?key|authorization|cookie|credential|password|secret|session|token)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1[redacted]',
    );
}

/**
 * Creates the intentionally narrow environment exposed to host-run guest
 * install/build processes. HOME is private to the build workspace so npm
 * cannot discover the service account's user configuration.
 */
export function fnWidgetBuildProcessEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  cwd: string,
  platform: string,
): Readonly<Record<string, string>> {
  const names = platform === 'win32'
    ? [...SAFE_PROCESS_ENVIRONMENT_NAMES, ...SAFE_WINDOWS_PROCESS_ENVIRONMENT_NAMES]
    : SAFE_PROCESS_ENVIRONMENT_NAMES;
  const safe: Record<string, string> = {
    CI: '1',
    HOME: cwd,
    NO_COLOR: '1',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  };
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined) safe[name] = value;
  }
  return Object.freeze(safe);
}
