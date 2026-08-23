import { describe, expect, test } from "bun:test";
import type { CapsuleMountErrorEvent } from "@omnidraw/capsule";

import { fnCapsuleMountErrorDiagnostic } from "../src/internal/fn.capsule-mount-error-diagnostic";

const artifactHash = `sha256:${"a".repeat(64)}` as const;

describe("fnCapsuleMountErrorDiagnostic", () => {
  test("maps the bounded guest console signal without retaining guest-controlled values", () => {
    const event = {
      format: "capsule-mount-error-v3",
      sequence: 1,
      timestamp: 10,
      lifecycleGeneration: 2,
      category: "vm",
      source: "guest.console",
      code: "GUEST_REPORTED_ERROR",
      fatal: false,
      artifactHash,
      runtimeGeneration: 3,
      message: "secret guest message",
      stack: "secret guest stack",
      arguments: [{ secret: true }],
    } as unknown as CapsuleMountErrorEvent;

    const diagnostic = fnCapsuleMountErrorDiagnostic(event);

    expect(diagnostic).toEqual({
      format: "omnidraw.widget-host-diagnostic.v1",
      phase: "runtime",
      category: "guest",
      code: "GUEST_REPORTED_ERROR",
      fatal: false,
      message: "The widget reported a runtime error.",
    });
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
  });

  test("retains the existing generic mapping for escaped guest exceptions", () => {
    const diagnostic = fnCapsuleMountErrorDiagnostic({
      format: "capsule-mount-error-v3",
      sequence: 1,
      timestamp: 10,
      lifecycleGeneration: 2,
      category: "vm",
      source: "guest.callback",
      code: "GUEST_EXCEPTION",
      fatal: false,
      artifactHash,
      runtimeGeneration: 3,
    });

    expect(diagnostic.message).toBe("The widget runtime failed.");
    expect(diagnostic.category).toBe("guest");
    expect(diagnostic.fatal).toBe(false);
  });
});
