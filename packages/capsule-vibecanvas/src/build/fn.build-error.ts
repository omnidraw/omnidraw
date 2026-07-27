type TWidgetBuildKind = 'source' | 'server' | 'ui';

function diagnosticField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const bounded = value.replace(/\s+/g, ' ').trim().slice(0, 240);
  return bounded || null;
}

function diagnosticReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized === '') return null;
  return normalized.length <= 320
    ? normalized
    : `…${normalized.slice(-319)}`;
}

function diagnosticPositiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function boundedDiagnostic(
  diagnostic: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, string | number>> | null {
  if (diagnostic === null) return null;
  const result: Record<string, string | number> = {};
  for (const name of [
    'code',
    'path',
    'specifier',
    'construct',
    'activeCssProfile',
    'requiredProfile',
  ] as const) {
    const value = diagnosticField(diagnostic[name]);
    if (value !== null) result[name] = value;
  }
  const reason = diagnosticReason(diagnostic.reason);
  if (reason !== null) result.reason = reason;
  for (const name of ['line', 'column'] as const) {
    const value = diagnosticPositiveInteger(diagnostic[name]);
    if (value !== null) result[name] = value;
  }
  return Object.freeze(result);
}

function diagnosticLocation(
  diagnostic: Readonly<Record<string, string | number>> | null,
): string {
  const path = diagnosticField(diagnostic?.path);
  if (path === null) return '';
  const line = diagnosticPositiveInteger(diagnostic?.line);
  const column = diagnosticPositiveInteger(diagnostic?.column);
  return ` at ${path}${line === null ? '' : `:${String(line)}${
    column === null ? '' : `:${String(column)}`
  }`}`;
}

function diagnosticMetadata(
  diagnostic: Readonly<Record<string, string | number>> | null,
): string {
  const fields = [
    ['specifier', diagnosticField(diagnostic?.specifier)],
    ['construct', diagnosticField(diagnostic?.construct)],
    ['activeCssProfile', diagnosticField(diagnostic?.activeCssProfile)],
    ['requiredProfile', diagnosticField(diagnostic?.requiredProfile)],
    ['reason', diagnosticReason(diagnostic?.reason)],
  ] as const;
  const values: string[] = [];
  for (const [name, value] of fields) {
    if (value !== null) values.push(`${name}=${JSON.stringify(value)}`);
  }
  return values.length === 0 ? '' : ` [${values.join(', ')}]`;
}

export function fnWidgetBuildError(kind: TWidgetBuildKind, cause?: unknown): Error {
  const causeRecord = cause && typeof cause === 'object'
    ? cause as Readonly<Record<string, unknown>>
    : null;
  const rawDiagnostic = causeRecord?.diagnostic && typeof causeRecord.diagnostic === 'object'
    ? causeRecord.diagnostic as Readonly<Record<string, unknown>>
    : null;
  const diagnostic = boundedDiagnostic(rawDiagnostic);
  const code = diagnosticField(diagnostic?.code)
    ?? diagnosticField(causeRecord?.code);
  const detail = code
    ? `: ${code}${diagnosticLocation(diagnostic)}${diagnosticMetadata(diagnostic)}`
    : '';
  return Object.assign(new Error(`Widget ${kind} build failed${detail}.`, { cause }), {
    code: 'WIDGET_BUILD_FAILED',
    ...(diagnostic === null ? {} : { diagnostic: Object.freeze({ ...diagnostic }) }),
  });
}
