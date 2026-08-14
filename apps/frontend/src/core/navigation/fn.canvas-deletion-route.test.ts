import { describe, expect, test } from "vitest";
import { fnCanvasDeletionRoute } from "./fn.canvas-deletion-route";

describe("fnCanvasDeletionRoute", () => {
  test("selects the first authoritative remaining Canvas after deleting the active Canvas", () => {
    expect(fnCanvasDeletionRoute({
      pathname: "/c/deleted",
      deletedCanvasId: "deleted",
      remainingCanvases: [{ id: "first", name: "First" }, { id: "second", name: "Second" }],
    })).toBe("/c/first");
  });

  test("uses the stable empty route for the final Canvas and preserves inactive routes", () => {
    expect(fnCanvasDeletionRoute({
      pathname: "/c/deleted",
      deletedCanvasId: "deleted",
      remainingCanvases: [],
    })).toBe("/");
    expect(fnCanvasDeletionRoute({
      pathname: "/c/active",
      deletedCanvasId: "inactive",
      remainingCanvases: [{ id: "active", name: "Active" }],
    })).toBeNull();
  });
});
