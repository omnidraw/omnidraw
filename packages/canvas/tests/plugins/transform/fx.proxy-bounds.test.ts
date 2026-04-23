import Konva from "konva";
import { describe, expect, test } from "vitest";
import { fxGetProxyBounds } from "../../../src/plugins/transform/fx.proxy-bounds";

function createMockScene() {
  const layer = new Konva.Layer();
  return {
    staticForegroundLayer: layer,
  };
}

describe("fxGetProxyBounds", () => {
  test("returns layer-space bounds for an unrotated shape", () => {
    const scene = createMockScene();
    const node = new Konva.Rect({ x: 30, y: 40, width: 120, height: 50, strokeWidth: 0 });

    const result = fxGetProxyBounds({
      scene: scene as never,
    }, {
      node,
    });

    expect(result.position.x).toBeCloseTo(30);
    expect(result.position.y).toBeCloseTo(40);
    expect(result.width).toBeCloseTo(120);
    expect(result.height).toBeCloseTo(50);
    expect(result.rotation).toBeCloseTo(0);
  });

  test("preserves node rotation in returned bounds", () => {
    const scene = createMockScene();
    const node = new Konva.Rect({ x: 10, y: 20, width: 100, height: 40, rotation: 45, strokeWidth: 0 });

    const result = fxGetProxyBounds({
      scene: scene as never,
    }, {
      node,
    });

    expect(result.width).toBeCloseTo(100);
    expect(result.height).toBeCloseTo(40);
    expect(result.rotation).toBeCloseTo(45);
  });
});
