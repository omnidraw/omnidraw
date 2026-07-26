type TWidgetBuildKind = 'source' | 'server' | 'ui';

function diagnosticField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const bounded = value.replace(/\s+/g, ' ').trim().slice(0, 240);
  return bounded || null;
}

export function fnWidgetBuildError(kind: TWidgetBuildKind, cause?: unknown): Error {
  const causeRecord = cause && typeof cause === 'object'
    ? cause as Readonly<Record<string, unknown>>
    : null;
  const diagnostic = causeRecord?.diagnostic && typeof causeRecord.diagnostic === 'object'
    ? causeRecord.diagnostic as Readonly<Record<string, unknown>>
    : null;
  const code = diagnosticField(diagnostic?.code)
    ?? diagnosticField(causeRecord?.code);
  const path = diagnosticField(diagnostic?.path);
  const specifier = diagnosticField(diagnostic?.specifier);
  const location = path ? ` at ${path}` : '';
  const importTarget = specifier ? ` (${specifier})` : '';
  const detail = code ? `: ${code}${location}${importTarget}` : '';
  return Object.assign(new Error(`Widget ${kind} build failed${detail}.`, { cause }), {
    code: 'WIDGET_BUILD_FAILED',
  });
}
