/** @file Pure deterministic reporting for the portable offline widget checker. */

export type TOfflineCheckPhase =
  | 'project'
  | 'manifest'
  | 'source'
  | 'typescript'
  | 'functions'
  | 'policy';

export type TOfflineCheckLocation = Readonly<{
  file: string;
  line?: number;
  column?: number;
}>;

export type TOfflineCheckDiagnostic = Readonly<{
  phase: TOfflineCheckPhase;
  code: string;
  severity: 'error';
  summary: string;
  location: TOfflineCheckLocation;
}>;

export type TOfflineCheckReport = Readonly<{
  schemaVersion: 1;
  ok: boolean;
  scope: 'offline-project';
  checks: readonly TOfflineCheckDiagnostic[];
  limitations: readonly [
    'resource-existence-not-checked',
    'preview-runtime-not-checked',
  ];
  truncated: boolean;
}>;

export function fnCreateOfflineCheckDiagnostic(
  args: Readonly<{
    phase: TOfflineCheckPhase;
    code: string;
    summary: string;
    file?: string;
    line?: number;
    column?: number;
  }>,
): TOfflineCheckDiagnostic {
  const normalizedSummary = args.summary
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || 'Offline validation failed.';
  return {
    phase: args.phase,
    code: args.code.slice(0, 100),
    severity: 'error',
    summary: normalizedSummary,
    location: {
      file: args.file ?? 'widget://.',
      ...(args.line === undefined ? {} : { line: args.line }),
      ...(args.column === undefined ? {} : { column: args.column }),
    },
  };
}

export function fnSortOfflineCheckDiagnostics(
  diagnostics: readonly TOfflineCheckDiagnostic[],
): readonly TOfflineCheckDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const leftKey = [
      left.phase,
      left.location.file,
      String(left.location.line ?? 0).padStart(10, '0'),
      String(left.location.column ?? 0).padStart(10, '0'),
      left.code,
      left.summary,
    ].join('\u0000');
    const rightKey = [
      right.phase,
      right.location.file,
      String(right.location.line ?? 0).padStart(10, '0'),
      String(right.location.column ?? 0).padStart(10, '0'),
      right.code,
      right.summary,
    ].join('\u0000');
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function fnCreateOfflineCheckReport(
  diagnostics: readonly TOfflineCheckDiagnostic[],
  maximumDiagnostics = 128,
): TOfflineCheckReport {
  const sorted = fnSortOfflineCheckDiagnostics(diagnostics);
  const checks = sorted.slice(0, maximumDiagnostics);
  return {
    schemaVersion: 1,
    ok: checks.length === 0,
    scope: 'offline-project',
    checks,
    limitations: [
      'resource-existence-not-checked',
      'preview-runtime-not-checked',
    ],
    truncated: sorted.length > checks.length,
  };
}

export function fnOfflineCheckExitCode(report: TOfflineCheckReport): 0 | 3 {
  return report.ok ? 0 : 3;
}

export function fnRenderOfflineCheckJson(report: TOfflineCheckReport): string {
  return `${JSON.stringify(report)}\n`;
}

export function fnRenderOfflineCheckHuman(report: TOfflineCheckReport): string {
  const lines = report.ok
    ? ['Offline widget check passed.']
    : [
        `Offline widget check failed with ${report.checks.length}${report.truncated ? '+' : ''} error(s).`,
        ...report.checks.map((check) => {
          const line = check.location.line === undefined
            ? ''
            : `:${check.location.line}${check.location.column === undefined ? '' : `:${check.location.column}`}`;
          return `${check.location.file}${line} [${check.code}] ${check.summary}`;
        }),
      ];
  lines.push(
    'Limitations: resource existence and readiness were not checked.',
    'Limitations: Preview rendering and runtime behavior were not checked.',
  );
  return `${lines.join('\n')}\n`;
}
