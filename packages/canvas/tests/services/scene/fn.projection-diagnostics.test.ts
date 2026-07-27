import { describe, expect, it } from "vitest";
import {
  fnCanvasProjectionDiagnosticGeneration,
} from "../../../src/services/scene/fn.projection-diagnostics";

describe("projection diagnostic generations", () => {
  const diagnostic = {
    code: "PROJECTOR_EXCEPTION" as const,
    message: "Element failed",
    projectorId: "test",
    target: {
      kind: "element" as const,
      id: "one",
    },
  };

  it("emits once while an error remains active and again after recovery", () => {
    const first = fnCanvasProjectionDiagnosticGeneration({
      previousKeys: new Set(),
      diagnostics: [diagnostic],
    });
    const repeated = fnCanvasProjectionDiagnosticGeneration({
      previousKeys: first.activeKeys,
      diagnostics: [diagnostic],
    });
    const recovered = fnCanvasProjectionDiagnosticGeneration({
      previousKeys: repeated.activeKeys,
      diagnostics: [],
    });
    const returned = fnCanvasProjectionDiagnosticGeneration({
      previousKeys: recovered.activeKeys,
      diagnostics: [diagnostic],
    });

    expect(first.added).toEqual([diagnostic]);
    expect(repeated.added).toEqual([]);
    expect(recovered.activeKeys.size).toBe(0);
    expect(returned.added).toEqual([diagnostic]);
  });
});
