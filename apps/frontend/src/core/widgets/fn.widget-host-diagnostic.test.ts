import { expect, test } from "bun:test";
import { fnWidgetHostDiagnosticDescription } from "./fn.widget-host-diagnostic";

test("widget host diagnostics expose bounded code and capability context", () => {
  expect(fnWidgetHostDiagnosticDescription({
    format: "omnidraw.widget-host-diagnostic.v1",
    phase: "runtime",
    category: "capability",
    code: "CAPABILITY_REJECTED",
    fatal: true,
    message: "A widget capability was denied or failed.",
    capability: "dom",
    operation: "mount",
  })).toBe("CAPABILITY_REJECTED · dom · mount");
});
