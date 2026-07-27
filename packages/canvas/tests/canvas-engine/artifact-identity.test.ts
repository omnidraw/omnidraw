import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import canvasEnginePackage from "@omnidraw/cangine/package.json";
import { describe, expect, it } from "vitest";
import canvasPackage from "../../package.json";

const AUDITED_ENGINE_COMMIT = "c4edb98b49a5571fa675e92c59c9c9e6bd919c35";
const AUDITED_ARTIFACT_PATH = resolve(
  process.cwd(),
  "vendor/omnidraw-cangine-0.2.2.tgz",
);
const AUDITED_ARTIFACT_SHA256 =
  "86e53924c4740df6afcae18b0a12c92d0b0db603624212a6ee28d114205cec83";
const AUDITED_DEPENDENCY =
  "file:./vendor/omnidraw-cangine-0.2.2.tgz";

describe("canvas-engine artifact identity", () => {
  it("uses the exact audited repository-local engine artifact and bytes", () => {
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
      version: "0.2.2",
      commit: AUDITED_ENGINE_COMMIT,
      dependency: AUDITED_DEPENDENCY,
      sha256: AUDITED_ARTIFACT_SHA256,
    });

    console.info("[canvas-engine artifact]", identity);
  });
});
