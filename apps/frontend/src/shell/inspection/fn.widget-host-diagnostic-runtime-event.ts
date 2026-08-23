import type { TWidgetHostDiagnostic } from "@omnidraw/sdk";

export type TWidgetHostDiagnosticRuntimeEvent = Readonly<{
  origin: string;
  phase: string;
  code: string;
  severity: "error" | "warning";
  message: string;
  artifactHash?: string;
  runtimeGeneration?: number;
  lifecycleGeneration?: number;
}>;

export function fnWidgetHostDiagnosticRuntimeEvent(
  diagnostic: TWidgetHostDiagnostic,
  fence?: Readonly<{ artifactHash: string; generation: number }>,
): TWidgetHostDiagnosticRuntimeEvent {
  const code = diagnostic.code.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128) || "WIDGET_HOST";
  const origin = diagnostic.category;

  return Object.freeze({
    origin,
    phase: diagnostic.phase,
    code,
    severity: diagnostic.fatal ? "error" : "warning",
    message: `${origin} ${code}`,
    ...(fence === undefined ? {} : {
      artifactHash: fence.artifactHash,
      runtimeGeneration: fence.generation,
      lifecycleGeneration: fence.generation,
    }),
  });
}
