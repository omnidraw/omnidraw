import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Cangine editor entrypoint", () => {
  it("imports in Node without browser globals", () => {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      [
        "delete globalThis.window;",
        "delete globalThis.document;",
        "await import('@omnidraw/cangine/editor');",
      ].join(""),
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
