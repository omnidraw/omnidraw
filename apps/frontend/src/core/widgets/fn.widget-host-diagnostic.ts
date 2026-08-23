import type { TWidgetHostDiagnostic } from "@omnidraw/sdk";

/** Product-safe diagnostic text; never stringifies guest/host objects. */
export function fnWidgetHostDiagnosticDescription(
  diagnostic: TWidgetHostDiagnostic,
): string {
  const scope = [diagnostic.capability, diagnostic.operation]
    .filter((value): value is string => value !== undefined)
    .join(" · ");
  return `${diagnostic.code}${scope.length === 0 ? "" : ` · ${scope}`}`;
}
