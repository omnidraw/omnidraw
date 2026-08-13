import type { TWidgetDiagnostic } from '../types';
import type { TWidgetBuildDiagnostic } from '../types';
import { fnWidgetDiagnosticFingerprint } from './fn.diagnostic';

type TArgs = Readonly<{
  diagnostics: readonly TWidgetBuildDiagnostic[];
  draftRevision: string;
  previewRevisionId: string | null;
  buildId: string;
  buildSequence: number;
  timestampMs: number;
  digestSha256(value: string): string;
}>;

type TArgsError = Readonly<{
  error: unknown;
  draftRevision: string;
  previewRevisionId: string | null;
  buildId: string;
  buildSequence: number;
  timestampMs: number;
  digestSha256(value: string): string;
}>;

function normalizedCode(value: string): string {
  const code = value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 128);
  return /^[A-Z][A-Z0-9_]{1,127}$/.test(code)
    ? code
    : 'WIDGET_BUILD_DIAGNOSTIC';
}

function normalizedMessage(value: string): string {
  return value.replaceAll('\\', '/')
    .replace(
      /(?:[A-Za-z]:)?(?:\/[^\s:'"]+)*\/((?:ui|server|shared)\/[A-Za-z0-9._/-]+)/g,
      '$1',
    )
    .replace(
      /(^|[\s("'=])(?:[A-Za-z]:\/|\/)[^\s:'"]+/g,
      '$1[host path]',
    )
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2_000) || 'Widget build failed.';
}

function normalizedFile(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const path = value.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (
    path.length < 1
    || path.length > 990
    || path.startsWith('/')
    || /^[A-Za-z]:/.test(path)
    || path.split('/').some((part) => part === '' || part === '.' || part === '..')
    || /[\u0000-\u001f\u007f]/.test(path)
  ) return undefined;
  return `widget://${path}`;
}

/** Converts build-tool output into the bounded untrusted diagnostic contract. */
export function fnNormalizeWidgetBuildDiagnostics(args: TArgs): readonly TWidgetDiagnostic[] {
  return Object.freeze(args.diagnostics.slice(0, 40).map((item) => {
    const file = normalizedFile(item.path);
    const line = file === undefined ? undefined : item.line;
    const column = line === undefined ? undefined : item.column;
    const fingerprintInput = {
      origin: 'build' as const,
      phase: 'building',
      code: normalizedCode(item.code),
      ...(file === undefined ? {} : { file }),
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
      buildId: args.buildId,
      previewRevisionId: args.previewRevisionId,
    };
    return Object.freeze({
      formatVersion: 1 as const,
      fingerprint: fnWidgetDiagnosticFingerprint({
        diagnostic: fingerprintInput,
        digestSha256: args.digestSha256,
      }),
      ...fingerprintInput,
      severity: item.severity,
      message: normalizedMessage(item.message),
      trust: 'untrusted' as const,
      draftRevision: args.draftRevision,
      buildSequence: args.buildSequence,
      occurrenceCount: 1,
      retryability: item.severity === 'error' ? 'unknown' as const : 'non-retryable' as const,
      timestampMs: args.timestampMs,
    });
  }));
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

/**
 * Converts one thrown runner/build failure into bounded untrusted data. Only
 * widget-relative source locations survive; host paths are discarded.
 */
export function fnNormalizeWidgetBuildError(args: TArgsError): TWidgetDiagnostic {
  const outer = record(args.error);
  const detail = record(outer?.diagnostic);
  const rawCode = typeof detail?.code === 'string'
    ? detail.code
    : typeof outer?.code === 'string'
      ? outer.code
      : 'WIDGET_BUILD_FAILED';
  const construct = typeof detail?.construct === 'string' ? detail.construct : '';
  const rawMessage = typeof detail?.reason === 'string'
    ? detail.reason
    : typeof outer?.message === 'string'
      ? outer.message
      : 'Widget build failed.';
  const message = normalizedMessage(rawMessage);
  const messageLocation = message.match(
    /\b((?:ui|server|shared)\/[A-Za-z0-9._/-]+):([1-9][0-9]*)(?::([1-9][0-9]*))?/,
  );
  const detailFile = typeof detail?.path === 'string'
    ? normalizedFile(detail.path)
    : undefined;
  const file = detailFile
    ?? (messageLocation?.[1] === undefined
      ? undefined
      : normalizedFile(messageLocation[1]));
  const parsedLine = typeof detail?.line === 'number'
    ? detail.line
    : messageLocation?.[2] === undefined
      ? undefined
      : Number(messageLocation[2]);
  const parsedColumn = typeof detail?.column === 'number'
    ? detail.column
    : messageLocation?.[3] === undefined
      ? undefined
      : Number(messageLocation[3]);
  const line = parsedLine !== undefined
    && file !== undefined
    && Number.isSafeInteger(parsedLine)
    && parsedLine >= 1
    && parsedLine <= 10_000_000
    ? parsedLine
    : undefined;
  const column = line !== undefined
    && parsedColumn !== undefined
    && Number.isSafeInteger(parsedColumn)
    && parsedColumn >= 1
    && parsedColumn <= 10_000_000
    ? parsedColumn
    : undefined;
  const outerMessage = typeof outer?.message === 'string' ? outer.message : '';
  const classification = `${rawCode} ${construct} ${outerMessage} ${rawMessage}`;
  const origin = /\b(?:source|manifest|validation)\b/i.test(classification)
    ? 'source' as const
    : /\bnpm\s+ci\b/i.test(construct)
    ? 'install' as const
    : /\bserver\b/i.test(classification)
      ? 'server' as const
      : 'build' as const;
  const phase = origin === 'source'
    ? 'validating'
    : origin === 'install'
    ? 'installing'
    : origin === 'server'
      ? 'server-building'
      : 'building';
  const code = normalizedCode(rawCode);
  const fingerprintInput = {
    origin,
    phase,
    code,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    buildId: args.buildId,
    previewRevisionId: args.previewRevisionId,
  };
  return Object.freeze({
    formatVersion: 1 as const,
    fingerprint: fnWidgetDiagnosticFingerprint({
      diagnostic: fingerprintInput,
      digestSha256: args.digestSha256,
    }),
    ...fingerprintInput,
    severity: 'error' as const,
    message,
    trust: 'untrusted' as const,
    draftRevision: args.draftRevision,
    buildSequence: args.buildSequence,
    occurrenceCount: 1,
    retryability: origin === 'install' ? 'retryable' as const : 'unknown' as const,
    timestampMs: args.timestampMs,
  });
}
