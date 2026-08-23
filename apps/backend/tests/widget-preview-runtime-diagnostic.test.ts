import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { fnProjectWidgetPreviewRuntimeDiagnostics } from "../src/shell/widget/fn.widget-preview-inspection";

const artifactHash = `sha256:${"a".repeat(64)}`;

describe("widget Preview runtime diagnostic projection", () => {
  test("retains the bounded guest-reported error identity as untrusted evidence", () => {
    const projected = fnProjectWidgetPreviewRuntimeDiagnostics({
      runtimeEvents: [{
        origin: "guest",
        phase: "runtime",
        code: "GUEST_REPORTED_ERROR",
        severity: "warning",
        message: "sdk GUEST_REPORTED_ERROR",
        artifactHash,
        runtimeGeneration: 3,
        lifecycleGeneration: 4,
      }],
      artifactHash,
      runtimeGeneration: 3,
      lifecycleGeneration: 4,
      droppedRuntimeEventCount: 0,
      digestSha256: (value) => createHash("sha256").update(value).digest("hex"),
    });

    expect(projected).toMatchObject({
      droppedCount: 0,
      truncated: false,
      entries: [{
        origin: "guest",
        phase: "runtime",
        code: "GUEST_REPORTED_ERROR",
        severity: "warning",
        message: "sdk GUEST_REPORTED_ERROR",
        trust: "untrusted",
        occurrenceCount: 1,
      }],
    });
  });
});
