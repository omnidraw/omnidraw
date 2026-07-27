import {
  describe,
  expect,
  it,
} from "vitest";
import {
  fnCanvasCameraDegreesToRadians,
  fnCanvasCameraRadiansToDegrees,
  fnClampCanvasCameraZoom,
  fnEngineCameraToLegacyViewport,
  fnLegacyViewportToEngineCamera,
} from "../../../src/engine/camera/fn.camera-state";

function expectCloseViewport(
  actual: { x: number; y: number; zoom: number },
  expected: { x: number; y: number; zoom: number },
): void {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
  expect(actual.zoom).toBeCloseTo(expected.zoom, 12);
}

describe("camera state conversion", () => {
  it("maps the legacy top-left translation exactly at zero rotation", () => {
    const state = fnLegacyViewportToEngineCamera({
      viewport: { x: 120, y: -40, zoom: 2 },
      viewportSize: { width: 800, height: 600 },
    });

    expect(state).toEqual({
      center: { x: 140, y: 170 },
      zoom: 2,
      rotation: 0,
    });
    expect(fnEngineCameraToLegacyViewport({
      state,
      viewportSize: { width: 800, height: 600 },
    })).toEqual({ x: 120, y: -40, zoom: 2 });
  });

  it("round-trips broad finite pan, zoom, size, and signed multi-turn rotations", () => {
    const sizes = [
      { width: 0, height: 0 },
      { width: 1, height: 1 },
      { width: 800, height: 600 },
      { width: 4096, height: 2160 },
    ];
    const pans = [-10_000, -123.5, 0, 72.25, 9_999];
    const zooms = [0.1, 0.25, 1, 3.5, 6];
    const rotations = [-1_080, -450, -30, 0, 30, 720, 1_080];

    for (const viewportSize of sizes) {
      for (let index = 0; index < pans.length; index += 1) {
        const viewport = {
          x: pans[index]!,
          y: pans[pans.length - index - 1]!,
          zoom: zooms[index]!,
        };
        for (const rotationDegrees of rotations) {
          const state = fnLegacyViewportToEngineCamera({
            viewport,
            viewportSize,
            rotationDegrees,
          });
          const roundTrip = fnEngineCameraToLegacyViewport({
            state,
            viewportSize,
          });

          expectCloseViewport(roundTrip, viewport);
          expect(
            fnCanvasCameraRadiansToDegrees({ radians: state.rotation }),
          ).toBeCloseTo(rotationDegrees, 10);
        }
      }
    }
  });

  it("preserves negative and multi-turn rotation instead of normalizing it", () => {
    for (const degrees of [-1_170, -450, 720, 1_125]) {
      const radians = fnCanvasCameraDegreesToRadians({ degrees });
      expect(fnCanvasCameraRadiansToDegrees({ radians }))
        .toBeCloseTo(degrees, 12);
    }
  });

  it("clamps finite zoom at the product constraints while preserving x/y", () => {
    const cases = [
      { zoom: -5, expected: 0.1 },
      { zoom: 0, expected: 0.1 },
      { zoom: 0.05, expected: 0.1 },
      { zoom: 0.1, expected: 0.1 },
      { zoom: 1, expected: 1 },
      { zoom: 6, expected: 6 },
      { zoom: 9, expected: 6 },
    ];

    for (const { zoom, expected } of cases) {
      expect(fnClampCanvasCameraZoom({ zoom })).toBe(expected);
      const state = fnLegacyViewportToEngineCamera({
        viewport: { x: 123, y: -456, zoom },
        viewportSize: { width: 900, height: 700 },
        rotationDegrees: -390,
      });
      expect(state.zoom).toBe(expected);
      expectCloseViewport(
        fnEngineCameraToLegacyViewport({
          state,
          viewportSize: { width: 900, height: 700 },
        }),
        { x: 123, y: -456, zoom: expected },
      );
    }
  });

  it("recomputes center on resize without changing the legacy viewport", () => {
    const viewport = { x: -250, y: 175, zoom: 2.5 };
    const rotationDegrees = -450;
    const before = fnLegacyViewportToEngineCamera({
      viewport,
      viewportSize: { width: 800, height: 600 },
      rotationDegrees,
    });
    const after = fnLegacyViewportToEngineCamera({
      viewport,
      viewportSize: { width: 1_200, height: 900 },
      rotationDegrees,
    });

    expect(after.center).not.toEqual(before.center);
    expectCloseViewport(
      fnEngineCameraToLegacyViewport({
        state: after,
        viewportSize: { width: 1_200, height: 900 },
      }),
      viewport,
    );
    expect(after.rotation).toBe(before.rotation);
  });

  it("rejects non-finite values, negative dimensions, and invalid constraints", () => {
    const valid = {
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { width: 800, height: 600 },
    };

    expect(() => fnLegacyViewportToEngineCamera({
      ...valid,
      viewport: { ...valid.viewport, x: Number.NaN },
    })).toThrow(/finite/);
    expect(() => fnLegacyViewportToEngineCamera({
      ...valid,
      viewport: { ...valid.viewport, zoom: Number.POSITIVE_INFINITY },
    })).toThrow(/finite/);
    expect(() => fnLegacyViewportToEngineCamera({
      ...valid,
      viewportSize: { width: -1, height: 600 },
    })).toThrow(/non-negative/);
    expect(() => fnLegacyViewportToEngineCamera({
      ...valid,
      rotationDegrees: Number.NaN,
    })).toThrow(/finite/);
    expect(() => fnClampCanvasCameraZoom({
      zoom: 1,
      minZoom: 2,
      maxZoom: 1,
    })).toThrow(/constraints/);
    expect(() => fnEngineCameraToLegacyViewport({
      state: {
        center: { x: Number.NEGATIVE_INFINITY, y: 0 },
        zoom: 1,
        rotation: 0,
      },
      viewportSize: valid.viewportSize,
    })).toThrow(/finite/);
  });
});
