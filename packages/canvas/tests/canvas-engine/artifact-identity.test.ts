import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canvasEnginePackage from "@omnidraw/cangine/package.json";
import { describe, expect, it } from "vitest";
import canvasPackage from "../../package.json";

const AUDITED_ENGINE_COMMIT = "3d8523ba6ad360a79e2540c98ef859290139d46a";
const AUDITED_ARTIFACT_PATH =
  "/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/omnidraw-cangine-0.1.2.tgz";
const AUDITED_ARTIFACT_SHA256 =
  "3c40e403ce72c899fc547496d4b785ab9050246d8f006b6baa26d0962b240b89";
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
      version: "0.1.2",
      commit: AUDITED_ENGINE_COMMIT,
      dependency: AUDITED_DEPENDENCY,
      sha256: AUDITED_ARTIFACT_SHA256,
    });

    console.info("[canvas-engine artifact]", identity);
  });
});
