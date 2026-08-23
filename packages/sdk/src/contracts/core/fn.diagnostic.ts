import type {
  TWidgetDiagnosticFingerprintInput,
} from '../types';

type TArgsFingerprint = Readonly<{
  diagnostic: TWidgetDiagnosticFingerprintInput;
  digestSha256(value: string): string;
}>;

export function fnCanonicalizeWidgetDiagnosticFingerprint(
  diagnostic: TWidgetDiagnosticFingerprintInput,
): string {
  return JSON.stringify([
    diagnostic.origin,
    diagnostic.phase,
    diagnostic.code,
    diagnostic.file ?? null,
    diagnostic.line ?? null,
    diagnostic.column ?? null,
    diagnostic.capability ?? null,
    diagnostic.operation ?? null,
    diagnostic.budgetDimension ?? null,
    diagnostic.buildId,
    diagnostic.previewRevisionId,
  ]);
}

export function fnWidgetDiagnosticFingerprint(args: TArgsFingerprint): string {
  return args.digestSha256(
    fnCanonicalizeWidgetDiagnosticFingerprint(args.diagnostic),
  );
}
