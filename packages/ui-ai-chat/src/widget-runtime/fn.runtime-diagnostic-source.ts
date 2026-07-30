export type TRuntimeGeneratedLocation = Readonly<{
  module: string;
  line: number;
  column: number;
}>;

export type TAuthoredSourceLocation = Readonly<{
  file: `widget://${string}`;
  line: number;
  column: number;
}>;

type TArgs = Readonly<{
  generated: TRuntimeGeneratedLocation;
  authoredPaths: readonly string[];
  trace(args: TRuntimeGeneratedLocation): Readonly<{
    source: string | null;
    line: number | null;
    column: number | null;
  }> | null;
}>;

const SAFE_MODULE = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[A-Za-z0-9@_+.,=/~-]{1,500}\.(?:[cm]?js)$/u;
const SAFE_AUTHORED_PATH = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[A-Za-z0-9@_+.,=/~-]{1,500}$/u;
const WIDGET_DIAGNOSTIC_COORDINATE_MAXIMUM = 10_000_000;

/**
 * Maps verified generated coordinates to one exact allowlisted authored path.
 * Only the normalized widget:// projection leaves this pure boundary.
 */
export function fnRuntimeDiagnosticSource(
  args: TArgs,
): TAuthoredSourceLocation | null {
  const generated = args.generated;
  if (
    !SAFE_MODULE.test(generated.module)
    || !Number.isSafeInteger(generated.line)
    || generated.line < 1
    || !Number.isSafeInteger(generated.column)
    || generated.column < 0
  ) return null;
  const original = args.trace(generated);
  if (
    original === null
    || typeof original.source !== 'string'
    || original.source.includes('\\')
    || /(?:^|\/)node_modules(?:\/|$)/u.test(original.source)
    || !Number.isSafeInteger(original.line)
    || original.line === null
    || original.line < 1
    || original.line > WIDGET_DIAGNOSTIC_COORDINATE_MAXIMUM
    || !Number.isSafeInteger(original.column)
    || original.column === null
    || original.column < 0
    || original.column >= WIDGET_DIAGNOSTIC_COORDINATE_MAXIMUM
  ) return null;
  const source = original.source;
  const matches = args.authoredPaths.filter((path) => (
    SAFE_AUTHORED_PATH.test(path)
    && (
      source === path
      || source.endsWith(`/${path}`)
    )
  ));
  if (matches.length !== 1) return null;
  return Object.freeze({
    file: `widget://${matches[0]}`,
    line: original.line,
    column: original.column + 1,
  });
}
