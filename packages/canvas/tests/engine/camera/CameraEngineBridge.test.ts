import {
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
  type TAabb,
  type TMat3,
  type TVec2,
} from "@vibecanvas/canvas-engine";
import { ManualClock } from "@vibecanvas/canvas-engine/testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CameraEngineBridge,
} from "../../../src/engine/camera/CameraEngineBridge";
import type {
  TCanvasCameraBridgeChangeEvent,
} from "../../../src/engine/camera/typed";
import {
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
} from "../../test-setup";
import { CanvasEngineTestFactory } from "../engine-test-backend";

function expectClosePoint(actual: TVec2, expected: TVec2): void {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

function expectCloseBounds(actual: TAabb, expected: TAabb): void {
  expect(actual.minX).toBeCloseTo(expected.minX, 9);
  expect(actual.minY).toBeCloseTo(expected.minY, 9);
  expect(actual.maxX).toBeCloseTo(expected.maxX, 9);
  expect(actual.maxY).toBeCloseTo(expected.maxY, 9);
}

function expectCloseMatrix(actual: TMat3, expected: TMat3): void {
  for (let index = 0; index < actual.length; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index]!, 9);
  }
}

describe("CameraEngineBridge", () => {
  let host: HTMLDivElement;
  let engine: IInfiniteCanvasEngine;
  let bridge: CameraEngineBridge | null;
  let hostRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };

  beforeEach(async () => {
    ensureDom();
    ensureRangeGeometryMocks();
    class TestResizeObserver {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    hostRect = {
      left: 20,
      top: 30,
      width: 800,
      height: 600,
    };
    host = createTestContainer({
      width: hostRect.width,
      height: hostRect.height,
    }) as HTMLDivElement;
    Object.defineProperty(host, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: hostRect.left,
        y: hostRect.top,
        left: hostRect.left,
        top: hostRect.top,
        right: hostRect.left + hostRect.width,
        bottom: hostRect.top + hostRect.height,
        width: hostRect.width,
        height: hostRect.height,
        toJSON: () => ({}),
      }),
    });
    engine = await createInfiniteCanvas({
      host,
      renderProfile: {
        vector2D: "webgl2",
        threeD: "disabled",
        portals: "dom",
      },
      backendFactories: [new CanvasEngineTestFactory()],
      clock: new ManualClock(),
      initialCamera: {
        center: { x: 0, y: 0 },
        zoom: 1,
        rotation: 0,
      },
    });
    bridge = null;
  });

  afterEach(async () => {
    bridge?.destroy();
    bridge = null;
    await engine.destroy();
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function createBridge(args?: {
    initialViewport?: { x: number; y: number; zoom: number };
    initialRotationDegrees?: number;
    cancelAnimationOnStop?: boolean;
  }): CameraEngineBridge {
    bridge = new CameraEngineBridge({
      camera: engine.camera,
      initialViewport: args?.initialViewport ?? { x: 0, y: 0, zoom: 1 },
      ...(args?.initialRotationDegrees === undefined
        ? {}
        : { initialRotationDegrees: args.initialRotationDegrees }),
      ...(args?.cancelAnimationOnStop === undefined
        ? {}
        : { cancelAnimationOnStop: args.cancelAnimationOnStop }),
    });
    return bridge;
  }

  it("owns an idempotent lifecycle, constraints, immutable snapshots, and teardown", () => {
    const constraints = vi.spyOn(engine.camera, "setConstraints");
    const cancelAnimation = vi.spyOn(engine.camera, "cancelAnimation");
    const subject = createBridge();
    const events: TCanvasCameraBridgeChangeEvent[] = [];
    const unsubscribe = subject.subscribe((event) => events.push(event));

    subject.start();
    subject.start();

    expect(subject.started).toBe(true);
    expect(constraints).toHaveBeenCalledTimes(1);
    expect(constraints).toHaveBeenLastCalledWith({
      minZoom: 0.1,
      maxZoom: 6,
      worldBounds: undefined,
    });
    expect(subject.snapshot).toEqual({
      viewport: { x: 0, y: 0, zoom: 1 },
      rotationDegrees: 0,
      viewportSize: { width: 800, height: 600 },
    });
    expect(Object.isFrozen(subject.snapshot)).toBe(true);
    expect(Object.isFrozen(subject.snapshot.viewport)).toBe(true);
    expect(Object.isFrozen(subject.snapshot.viewportSize)).toBe(true);
    expect("camera" in subject).toBe(false);

    subject.stop();
    subject.stop();
    expect(subject.started).toBe(false);
    expect(cancelAnimation).toHaveBeenCalledTimes(1);

    engine.camera.panByScreen({ x: 10, y: 5 });
    expect(subject.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(events).toHaveLength(0);

    subject.start();
    expect(constraints).toHaveBeenCalledTimes(2);
    expect(subject.viewport).toEqual({ x: 10, y: 5, zoom: 1 });
    expect(events).toHaveLength(0);

    engine.camera.panByScreen({ x: 1, y: -2 });
    expect(events).toHaveLength(1);
    expect(events[0]?.current.viewport).toEqual({
      x: 11,
      y: 3,
      zoom: 1,
    });
    expect(Object.isFrozen(events[0])).toBe(true);

    unsubscribe();
    unsubscribe();
    subject.destroy();
    subject.destroy();
    expect(cancelAnimation).toHaveBeenCalledTimes(2);
    expect(() => subject.start()).toThrow(/destroyed/);

    engine.camera.panByScreen({ x: 2, y: 2 });
    expect(events).toHaveLength(1);
  });

  it("sets, pans with explicit signs, clamps, and emits once per engine change", () => {
    const subject = createBridge();
    const events: TCanvasCameraBridgeChangeEvent[] = [];
    subject.subscribe((event) => events.push(event));
    subject.start();

    subject.setViewport({ x: 100, y: 50, zoom: 2 });
    expect(subject.viewport).toEqual({ x: 100, y: 50, zoom: 2 });
    expect(events).toHaveLength(1);

    subject.panByScreen({ x: 10, y: -5 });
    expect(subject.viewport).toEqual({ x: 110, y: 45, zoom: 2 });
    expect(events).toHaveLength(2);

    subject.pan(3, -2);
    expect(subject.viewport).toEqual({ x: 107, y: 47, zoom: 2 });
    expect(events).toHaveLength(3);

    subject.panByWorld({ x: 3, y: -2 });
    expect(subject.viewport).toEqual({ x: 101, y: 51, zoom: 2 });
    expect(events).toHaveLength(4);

    subject.set({ x: -15, y: 25, zoom: 100 });
    expect(subject.viewport).toEqual({ x: -15, y: 25, zoom: 6 });
    subject.set({ x: -15, y: 25, zoom: -100 });
    expect(subject.viewport).toEqual({ x: -15, y: 25, zoom: 0.1 });

    const count = events.length;
    subject.set({ x: -15, y: 25, zoom: 0.1 });
    expect(events).toHaveLength(count);
  });

  it("keeps the world anchor stable while zooming at a viewport point", () => {
    const subject = createBridge();
    const events: TCanvasCameraBridgeChangeEvent[] = [];
    subject.subscribe((event) => events.push(event));
    subject.start();
    subject.setViewport({ x: 100, y: 50, zoom: 1 });
    events.length = 0;

    const anchor = { x: 200, y: 150 };
    const worldBefore = subject.viewportToWorld(anchor);
    subject.zoomAtViewportPoint(3, anchor);
    const worldAfter = subject.viewportToWorld(anchor);

    expectClosePoint(worldAfter, worldBefore);
    expect(subject.viewport.zoom).toBe(3);
    expect(events).toHaveLength(1);
  });

  it("observes engine-originated changes without feedback or double emission", () => {
    const subject = createBridge();
    const events: TCanvasCameraBridgeChangeEvent[] = [];
    subject.subscribe(() => {
      throw new Error("listener isolation");
    });
    subject.subscribe((event) => events.push(event));
    subject.start();
    const set = vi.spyOn(engine.camera, "set");

    engine.camera.set({
      center: { x: 250, y: -100 },
      zoom: 2,
      rotation: Math.PI / 3,
    }, { source: "wheel" });

    expect(set).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("wheel");
    expect(events[0]?.current.rotationDegrees).toBeCloseTo(60, 12);
    expect(subject.snapshot).toBe(events[0]?.current);
  });

  it("reapplies resize around the same legacy top-left viewport exactly once", () => {
    const subject = createBridge();
    const events: TCanvasCameraBridgeChangeEvent[] = [];
    subject.subscribe((event) => events.push(event));
    subject.start();
    subject.setViewport(
      { x: -250, y: 175, zoom: 2.5 },
      { rotationDegrees: -450 },
    );
    const beforeState = engine.camera.state;
    events.length = 0;

    hostRect.width = 1_200;
    hostRect.height = 900;
    engine.resize({ width: hostRect.width, height: hostRect.height });
    expect(subject.viewportSize).toEqual({ width: 800, height: 600 });

    subject.reapplyViewportSize();

    expect(subject.viewport.x).toBeCloseTo(-250, 9);
    expect(subject.viewport.y).toBeCloseTo(175, 9);
    expect(subject.viewport.zoom).toBe(2.5);
    expect(subject.rotationDegrees).toBeCloseTo(-450, 10);
    expect(subject.viewportSize).toEqual({ width: 1_200, height: 900 });
    expect(engine.camera.state.center).not.toEqual(beforeState.center);
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("viewport-resize");

    subject.reapplyViewportSize();
    expect(events).toHaveLength(1);
  });

  it("applies the persisted viewport against the current size on first start", () => {
    const subject = createBridge({
      initialViewport: { x: 35, y: -80, zoom: 2 },
      initialRotationDegrees: 390,
    });
    hostRect.width = 1_000;
    hostRect.height = 750;
    engine.resize({ width: hostRect.width, height: hostRect.height });

    subject.start();

    expect(subject.viewport.x).toBeCloseTo(35, 9);
    expect(subject.viewport.y).toBeCloseTo(-80, 9);
    expect(subject.viewport.zoom).toBe(2);
    expect(subject.rotationDegrees).toBeCloseTo(390, 10);
    expect(subject.viewportSize).toEqual({ width: 1_000, height: 750 });
  });

  it("forwards every named coordinate conversion without exposing the controller", () => {
    const subject = createBridge({ initialRotationDegrees: 30 });
    subject.start();
    subject.setViewport(
      { x: -70, y: 140, zoom: 2 },
      { rotationDegrees: 30 },
    );

    const client = { x: 325, y: 275 };
    const viewport = { x: 200, y: 160 };
    const world = { x: -45, y: 110 };
    const bounds = { minX: -10, minY: 20, maxX: 80, maxY: 130 };

    expectClosePoint(
      subject.clientToViewport(client),
      engine.camera.clientToViewport(client),
    );
    expectClosePoint(
      subject.viewportToClient(viewport),
      engine.camera.viewportToClient(viewport),
    );
    expectClosePoint(
      subject.viewportToWorld(viewport),
      engine.camera.viewportToWorld(viewport),
    );
    expectClosePoint(
      subject.worldToViewport(world),
      engine.camera.worldToViewport(world),
    );
    expectClosePoint(
      subject.worldToClient(world),
      engine.camera.worldToClient(world),
    );
    expectCloseBounds(
      subject.worldRectToViewport(bounds),
      engine.camera.worldRectToViewport(bounds),
    );
    expectCloseBounds(
      subject.visibleWorldBounds(),
      engine.camera.visibleWorldBounds(),
    );
    expectCloseMatrix(
      subject.worldToViewportMatrix(),
      engine.camera.worldToViewportMatrix(),
    );
    expectCloseMatrix(
      subject.viewportToWorldMatrix(),
      engine.camera.viewportToWorldMatrix(),
    );
  });

  it("forwards degree-based rotation, zero-duration animation, and cancellation", async () => {
    const subject = createBridge();
    const cancelAnimation = vi.spyOn(engine.camera, "cancelAnimation");
    const events: TCanvasCameraBridgeChangeEvent[] = [];
    subject.subscribe((event) => events.push(event));
    subject.start();

    const anchor = { x: 120, y: 240 };
    const worldBefore = subject.viewportToWorld(anchor);
    subject.rotateAtViewportPoint(-450, anchor);
    expectClosePoint(subject.viewportToWorld(anchor), worldBefore);
    expect(subject.rotationDegrees).toBeCloseTo(-450, 10);

    events.length = 0;
    await subject.animateTo(
      { x: 45, y: -60, zoom: 4 },
      { durationMs: 0, rotationDegrees: 720 },
    );
    expect(subject.viewport.x).toBeCloseTo(45, 9);
    expect(subject.viewport.y).toBeCloseTo(-60, 9);
    expect(subject.viewport.zoom).toBe(4);
    expect(subject.rotationDegrees).toBeCloseTo(720, 10);
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe("animation");

    subject.cancelAnimation();
    expect(cancelAnimation).toHaveBeenCalledTimes(1);
  });

  it("can leave controller animation ownership outside stop when configured", () => {
    const cancelAnimation = vi.spyOn(engine.camera, "cancelAnimation");
    const subject = createBridge({ cancelAnimationOnStop: false });
    subject.start();
    subject.stop();
    subject.stop();
    subject.destroy();

    expect(cancelAnimation).not.toHaveBeenCalled();
  });

  it("rejects camera operations while inactive", () => {
    const subject = createBridge();

    expect(() => subject.panByScreen({ x: 1, y: 1 }))
      .toThrow(/not started/);
    subject.start();
    subject.stop();
    expect(() => subject.worldToViewport({ x: 0, y: 0 }))
      .toThrow(/not started/);
  });
});
