import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { buildEditedContentPreview } from "../lib/edit-preview";

describe("edit preview", () => {
  test("applies edits sequentially so later oldText can become unique after earlier edits", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "functional-core-edit-preview-"));
    const filePath = join(tempDir, "tx.apply-selection-style-change.ts");

    try {
      await writeFile(filePath, [
        "redo: () => {",
        "  fnApplyElements(portal.editor, dedupedAfterElements);",
        "  portal.txRefreshEditingShape1d();",
        "  portal.crdt.patch({ elements: dedupedAfterElements, groups: [] });",
        "},",
        "",
        "undo: () => {",
        "  fnApplyElements(portal.editor, dedupedAfterElements);",
        "  portal.txRefreshEditingShape1d();",
        "  portal.crdt.patch({ elements: dedupedAfterElements, groups: [] });",
        "},",
      ].join("\n"));

      const result = await buildEditedContentPreview(filePath, {
        path: filePath,
        edits: [
          {
            oldText: "redo: () => {",
            newText: "redoLatest: () => {",
          },
          {
            oldText: "redoLatest: () => {\n  fnApplyElements(portal.editor, dedupedAfterElements);",
            newText: "redoLatest: () => {\n  fnApplyElements(portal.editor, dedupedAfterElements);\n  // updated",
          },
          {
            oldText: "redoLatest: () => {\n  fnApplyElements(portal.editor, dedupedAfterElements);\n  // updated\n  portal.txRefreshEditingShape1d();\n  portal.crdt.patch({ elements: dedupedAfterElements, groups: [] });\n},",
            newText: "redoLatest: () => {\n  fnApplyElements(portal.editor, dedupedAfterElements);\n  // updated\n  portal.txRefreshEditingShape1d();\n  portal.crdt.patch({ elements: dedupedAfterElements, groups: [], source: \"redo\" });\n},",
          },
        ],
      }, "tx-check");

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('source: "redo"');
      expect(result.content).toContain("undo: () => {");
      expect(result.content).not.toContain('source: "undo"');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
