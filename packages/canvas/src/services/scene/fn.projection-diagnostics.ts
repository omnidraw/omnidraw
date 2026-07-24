import type { TCanvasProjectionDiagnostic } from "../../engine/typed";

export function fnCanvasProjectionDiagnosticKey(args: {
  diagnostic: TCanvasProjectionDiagnostic;
}) {
  return JSON.stringify({
    code: args.diagnostic.code,
    message: args.diagnostic.message,
    projectorId: args.diagnostic.projectorId ?? null,
    target: args.diagnostic.target ?? null,
  });
}

export function fnCanvasProjectionDiagnosticGeneration(args: {
  previousKeys: ReadonlySet<string>;
  diagnostics: readonly TCanvasProjectionDiagnostic[];
}) {
  const activeKeys = new Set<string>();
  const added: TCanvasProjectionDiagnostic[] = [];
  for (const diagnostic of args.diagnostics) {
    const key = fnCanvasProjectionDiagnosticKey({ diagnostic });
    activeKeys.add(key);
    if (!args.previousKeys.has(key)) {
      added.push(diagnostic);
    }
  }
  return {
    activeKeys,
    added,
  };
}
