import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canvasEnginePackage from "@omnidraw/cangine/package.json";
import { describe, expect, it } from "vitest";
import canvasPackage from "../../package.json";

const AUDITED_ENGINE_COMMIT = "07fef171dc110a8ae1aa54820ee1a13b5c2f29a1";
const AUDITED_ARTIFACT_PATH =
  "/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/omnidraw-cangine-0.2.0.tgz";
const AUDITED_ARTIFACT_SHA256 =
  "65c2155bb02cb78b0ea812d660c54b49835421e97dbe5eb665821259d3b48b1c";
const AUDITED_DEPENDENCY =
  `file:${AUDITED_ARTIFACT_PATH}`;

describe("canvas-engine artifact identity", () => {
  it("uses the exact audited absolute engine artifact and bytes", () => {
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
      version: "0.2.0",
      commit: AUDITED_ENGINE_COMMIT,
      dependency: AUDITED_DEPENDENCY,
      sha256: AUDITED_ARTIFACT_SHA256,
    });

    console.info("[canvas-engine artifact]", identity);
  });
});
