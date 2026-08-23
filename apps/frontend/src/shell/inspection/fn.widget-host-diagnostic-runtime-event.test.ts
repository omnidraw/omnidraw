import { describe, expect, test } from "bun:test";
import { fnWidgetHostDiagnosticRuntimeEvent } from "./fn.widget-host-diagnostic-runtime-event";

describe("inspection widget-host diagnostic projection", () => {
  test("preserves the guest origin and satisfies the content-free browser evidence contract", () => {
    expect(fnWidgetHostDiagnosticRuntimeEvent({
      format: "omnidraw.widget-host-diagnostic.v1",
      phase: "runtime",
      category: "guest",
      code: "GUEST_REPORTED_ERROR",
      fatal: false,
      message: "guest-controlled content must not be projected",
    }, {
      artifactHash: `sha256:${"a".repeat(64)}`,
      generation: 3,
    })).toEqual({
      origin: "guest",
      phase: "runtime",
      code: "GUEST_REPORTED_ERROR",
      severity: "warning",
      message: "guest GUEST_REPORTED_ERROR",
      artifactHash: `sha256:${"a".repeat(64)}`,
      runtimeGeneration: 3,
      lifecycleGeneration: 3,
    });
  });
});
