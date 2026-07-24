import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canvasEnginePackage from "@omnidraw/cangine/package.json";
import { describe, expect, it } from "vitest";
import canvasPackage from "../../package.json";

const AUDITED_ENGINE_COMMIT = "bb911a1f9ad812314ebd4eee31d553bb85bfaea5";
const AUDITED_ARTIFACT_PATH =
  "/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/omnidraw-cangine-0.1.0.tgz";
const AUDITED_ARTIFACT_SHA256 =
  "f917220e3199a2939c8e5dc7cde4a59009e10123160f795dacf108a39ecf0486";
const AUDITED_DEPENDENCY = `file:${AUDITED_ARTIFACT_PATH}`;

describe("canvas-engine artifact identity", () => {
  it("uses the exact audited filepath artifact and bytes", () => {
    const dependency =
      canvasPackage.devDependencies["@omnidraw/cangine"];
    const artifactSha256 = createHash("sha256")
      .update(readFileSync(AUDITED_ARTIFACT_PATH))
      .digest("hex");
    const identity = {
      package: canvasEnginePackage.name,
      version: canvasEnginePackage.version,
      commit: AUDITED_ENGINE_COMMIT,
      dependency,
      sha256: artifactSha256,
    };

    expect(identity).toEqual({
      package: "@omnidraw/cangine",
      version: "0.1.0",
      commit: AUDITED_ENGINE_COMMIT,
      dependency: AUDITED_DEPENDENCY,
      sha256: AUDITED_ARTIFACT_SHA256,
    });

    console.info("[canvas-engine artifact]", identity);
  });
});
