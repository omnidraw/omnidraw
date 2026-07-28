import { describe, expect, test } from "bun:test";
import type {
  IEditorImageImportPort,
  IEditorSceneMutationPort,
  TEditorSceneMutationRequest,
  TPreparedImageImportRequest,
} from "@omnidraw/cangine/editor";

describe("Cangine controlled-editor consumer contract", () => {
  test("resolves the packed 0.2.4 editor entrypoint", async () => {
    const editorEntrypoint = Bun.resolveSync(
      "@omnidraw/cangine/editor",
      import.meta.dir,
    );
    const manifestPath = Bun.resolveSync(
      "@omnidraw/cangine/package.json",
      import.meta.dir,
    );
    const manifest = await Bun.file(manifestPath).json() as {
      name: string;
      version: string;
    };

    expect(editorEntrypoint).toContain(
      "node_modules/.bun/@omnidraw+cangine@0.2.4/",
    );
    expect(editorEntrypoint).toEndWith("/dist/editor/index.js");
    expect(manifest).toMatchObject({
      name: "@omnidraw/cangine",
      version: "0.2.4",
    });
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
