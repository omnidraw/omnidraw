import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  resolvePreviewInspectionReleaseRuntime,
} from "../src/shell/preview/preview-inspection-release-runtime";

describe("Preview inspection release runtime", () => {
  test("resolves the frontend-owned isolated shell from the backend runtime", () => {
    const sourceCliDir = resolve("/repo/apps/backend/src/shell/runtime");

    expect(resolvePreviewInspectionReleaseRuntime({ sourceCliDir })).toEqual({
      shellPath: resolve("/repo/apps/frontend/dist/inspection"),
    });
  });
});
