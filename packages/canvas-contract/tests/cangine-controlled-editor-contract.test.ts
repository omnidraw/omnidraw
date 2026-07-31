import { describe, expect, test } from "bun:test";
import type {
  IEditorImageImportPort,
  IEditorSceneMutationPort,
  TEditorSceneMutationRequest,
  TPreparedImageImportRequest,
} from "@omnidraw/cangine/editor";

describe("Cangine controlled-editor consumer contract", () => {
  test("resolves the packed 0.5.3 public entrypoints", async () => {
    const publicEntrypoints = new Map([
      ["@omnidraw/cangine", "/dist/index.js"],
      ["@omnidraw/cangine/types", "/dist/types.js"],
      ["@omnidraw/cangine/geometry", "/dist/geometry/index.js"],
      ["@omnidraw/cangine/scene", "/dist/scene/index.js"],
      ["@omnidraw/cangine/testing", "/dist/testing/index.js"],
      ["@omnidraw/cangine/backend", "/dist/backend/index.js"],
      ["@omnidraw/cangine/editor", "/dist/editor/index.js"],
    ] as const);
    const manifestPath = Bun.resolveSync(
      "@omnidraw/cangine/package.json",
      import.meta.dir,
    );
    const manifest = await Bun.file(manifestPath).json() as {
      name: string;
      version: string;
      exports: Readonly<Record<string, unknown>>;
    };

    for (const [specifier, suffix] of publicEntrypoints) {
      const resolved = Bun.resolveSync(specifier, import.meta.dir);
      expect(resolved).toContain(
        "node_modules/.bun/@omnidraw+cangine@0.5.3/",
      );
      expect(resolved).toEndWith(suffix);
    }
    expect(manifest).toMatchObject({
      name: "@omnidraw/cangine",
      version: "0.5.3",
    });
    expect(manifest.exports).not.toHaveProperty("./integrations/capsule");
    expect(() => Bun.resolveSync(
      "@omnidraw/cangine/integrations/capsule",
      import.meta.dir,
    )).toThrow();
  });

  test("imports the scene reducer without touching renderer globals", () => {
    const consumer = Bun.spawnSync({
      cmd: [process.execPath, "--eval", `
        for (const name of [
          "window",
          "document",
          "HTMLCanvasElement",
          "OffscreenCanvas",
        ]) {
          Object.defineProperty(globalThis, name, {
            configurable: true,
            get() {
              throw new Error("renderer global accessed: " + name);
            },
          });
        }
        const scene = await import("@omnidraw/cangine/scene");
        const state = scene.createSceneReductionState({
          schemaVersion: "1.0.0",
          rootLayerIds: [],
          nodes: [],
        });
        const reduction = scene.reduceSerializedSceneCommands(state, []);
        if (reduction.state !== state || reduction.changes.length !== 0) {
          throw new Error("unexpected empty reduction");
        }
      `],
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(new TextDecoder().decode(consumer.stderr)).toBe("");
    expect(consumer.exitCode).toBe(0);
  });

  test("exposes synchronous scene and prepared-image mutation ports", () => {
    const scenePort: IEditorSceneMutationPort = {
      commit(request: TEditorSceneMutationRequest) {
        return {
          projectedSceneRevision: request.basisSceneRevision + 1,
        };
      },
    };
    const imagePort: IEditorImageImportPort = {
      commitPrepared(request: TPreparedImageImportRequest) {
        return scenePort.commit(request.mutation);
      },
    };

    expect(typeof scenePort.commit).toBe("function");
    expect(typeof imagePort.commitPrepared).toBe("function");
  });
});
