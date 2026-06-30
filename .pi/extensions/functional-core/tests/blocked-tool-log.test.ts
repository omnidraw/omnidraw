import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { recordBlockedToolCall } from "../lib/blocked-tool-log";

describe("blocked tool log", () => {
  test("stores blocked tool call payload as jsonl", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "functional-core-block-log-"));

    try {
      await recordBlockedToolCall(cwd, {
        checkName: "fx-check",
        toolName: "edit",
        cwd,
        filePath: "packages/canvas/src/new-plugins/shape2d/fx.attached-text.ts",
        absolutePath: join(cwd, "packages/canvas/src/new-plugins/shape2d/fx.attached-text.ts"),
        reason: "fx-check blocked sample",
        input: {
          path: "packages/canvas/src/new-plugins/shape2d/fx.attached-text.ts",
          edits: [{ oldText: "a", newText: "b" }],
        },
        createdAt: "2026-04-14T00:00:00.000Z",
      });

      const logContent = await readFile(join(cwd, ".pi/logs/functional-core-blocked-tool-calls.jsonl"), "utf8");
      const lines = logContent.trim().split("\n");

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual({
        checkName: "fx-check",
        toolName: "edit",
        cwd,
        filePath: "packages/canvas/src/new-plugins/shape2d/fx.attached-text.ts",
        absolutePath: join(cwd, "packages/canvas/src/new-plugins/shape2d/fx.attached-text.ts"),
        reason: "fx-check blocked sample",
        input: {
          path: "packages/canvas/src/new-plugins/shape2d/fx.attached-text.ts",
          edits: [{ oldText: "a", newText: "b" }],
        },
        createdAt: "2026-04-14T00:00:00.000Z",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
