import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import canvasEnginePackage from "@vibecanvas/canvas-engine/package.json";
import { describe, expect, it } from "vitest";
import canvasPackage from "../../package.json";

const AUDITED_ENGINE_COMMIT = "58009176fd4622c661e50ddf0c7d3216633c76c0";
const AUDITED_ARTIFACT_PATH =
  "/Users/omarezzat/Workspace/vibecanvas/canvas-engine/artifacts/vibecanvas-canvas-engine-0.1.0.tgz";
const AUDITED_ARTIFACT_SHA256 =
  "7069d90a20253b69f7c805d369961f09e737c133bb3594684e71ca9fb0c73240";
const AUDITED_DEPENDENCY = `file:${AUDITED_ARTIFACT_PATH}`;

describe("canvas-engine artifact identity", () => {
  it("uses the exact audited filepath artifact and bytes", () => {
    const dependency =
      canvasPackage.devDependencies["@vibecanvas/canvas-engine"];
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
      package: "@vibecanvas/canvas-engine",
      version: "0.1.0",
      commit: AUDITED_ENGINE_COMMIT,
      dependency: AUDITED_DEPENDENCY,
      sha256: AUDITED_ARTIFACT_SHA256,
    });

    console.info("[canvas-engine artifact]", identity);
  });
});
