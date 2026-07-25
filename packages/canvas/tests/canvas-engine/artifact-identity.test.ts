import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canvasEnginePackage from "@omnidraw/cangine/package.json";
import { describe, expect, it } from "vitest";
import canvasPackage from "../../package.json";

const AUDITED_ENGINE_COMMIT = "3b91fcb8133c5f4dd627d03c469e511d30c57acc";
const AUDITED_ARTIFACT_PATH =
  "/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/omnidraw-cangine-0.2.1.tgz";
const AUDITED_ARTIFACT_SHA256 =
  "1186629c238c53e731a4aab92873e3d9b25016902a96d325780e42bf277acc86";
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
      version: "0.2.1",
      commit: AUDITED_ENGINE_COMMIT,
      dependency: AUDITED_DEPENDENCY,
      sha256: AUDITED_ARTIFACT_SHA256,
    });

    console.info("[canvas-engine artifact]", identity);
  });
});
