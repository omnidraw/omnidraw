/** @file Pure comparison and bounded diagnostic projection for host-validated widget build generations. */

import type {
  TWidgetBuildReceipt,
  TWidgetBuildReceiptOutput,
} from '#backend/core/widget-domain';

export type TWidgetBuildGenerationDiagnostic = Readonly<{
  code: string;
  message: string;
  path: string | null;
}>;

export function fnWidgetBuildGenerationPollOrder<T>(args: Readonly<{
  entries: readonly T[];
  cursor: number;
}>): readonly T[] {
  if (args.entries.length === 0) return Object.freeze([]);
  const cursor = Number.isSafeInteger(args.cursor)
    ? ((args.cursor % args.entries.length) + args.entries.length) % args.entries.length
    : 0;
  return Object.freeze([
    ...args.entries.slice(cursor),
    ...args.entries.slice(0, cursor),
  ]);
}

export function fnWidgetBuildReceiptOutputsMatch(args: Readonly<{
  receipt: TWidgetBuildReceipt;
  observedOutputs: readonly TWidgetBuildReceiptOutput[];
}>): boolean {
  if (args.observedOutputs.length !== args.receipt.outputs.length) return false;
  for (let index = 0; index < args.observedOutputs.length; index += 1) {
    const observed = args.observedOutputs[index]!;
    const expected = args.receipt.outputs[index];
    if (
      expected === undefined
      || observed.path !== expected.path
      || observed.byteSize !== expected.byteSize
      || observed.sha256 !== expected.sha256
    ) return false;
  }
  return true;
}

export function fnWidgetBuildGenerationDiagnostic(
  error: unknown,
): TWidgetBuildGenerationDiagnostic {
  const candidateCode = error !== null
    && typeof error === 'object'
    && 'code' in error
    && typeof error.code === 'string'
      ? error.code
      : 'BUILD_IMPORT_FAILED';
  const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(candidateCode)
    ? candidateCode
    : 'BUILD_IMPORT_FAILED';
  const candidateMessage = error instanceof Error ? error.message : 'Build output could not be validated.';
  const message = candidateMessage
    .replace(/(?:file:\/\/)?\/?(?:Users|home|private|tmp|var)\/[A-Za-z0-9_./\\-]+/g, 'widget://project')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, 2_000);
  return Object.freeze({ code, message, path: null });
}
