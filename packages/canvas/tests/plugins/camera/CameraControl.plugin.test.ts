import { SyncHook } from "@vibecanvas/tapable";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { LOCAL_BROWSER_TENANT_SCOPE } from "../../../src/CONSTANTS";
import { createCameraControlPlugin } from "../../../src/plugins/camera-control/CameraControl.plugin";
import {
  MAX_CAMERA_ZOOM,
  MIN_CAMERA_ZOOM,
} from "../../../src/plugins/camera-control/CONSTANTS";
import { fnNormalizeCameraState } from "../../../src/plugins/camera-control/fn.normalize-camera-state";
import { ensureDom } from "../../test-setup";

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];
  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
      return true;
    };
  }
  call(...args: TArgs) {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

function pointerEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "pointer-move",
    pointerId: 1,
    button: 0,
    buttons: 1,
    pointerType: "mouse",
    client: { x: 0, y: 0 },
    viewport: { x: 0, y: 0 },
    world: { x: 0, y: 0 },
    pressure: 0,
    tilt: { x: 0, y: 0 },
    deltaViewport: { x: 12, y: -8 },
    deltaWorld: { x: 12, y: -8 },
    hit: null,
    timeStamp: 1,
    modifiers: {
      alt: false,
      control: false,
      meta: false,
      shift: false,
    },
    ...overrides,
  };
}

describe("CameraControl plugin", () => {
  beforeEach(() => {
    ensureDom();
  });

  it("uses normalized pointer and wheel input without a renderer overlay", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const capturePointer = vi.fn();
    const releasePointer = vi.fn();
    const pan = vi.fn();
    const zoomAtScreenPoint = vi.fn();
    const hooks = {
      init: new TestHook<[]>(),
      destroy: new TestHook<[]>(),
      toolSelect: new TestHook<[string]>(),
      pointerDown: new TestHook<[ReturnType<typeof pointerEvent>]>(),
      pointerMove: new TestHook<[ReturnType<typeof pointerEvent>]>(),
      pointerUp: new TestHook<[ReturnType<typeof pointerEvent>]>(),
      pointerCancel: new TestHook<[ReturnType<typeof pointerEvent>]>(),
      pointerWheel: new TestHook<[ReturnType<typeof pointerEvent>]>(),
    };
    const camera = {
      x: 0,
      y: 0,
      zoom: 2,
      pan,
      zoomAtScreenPoint,
      setViewport: vi.fn(),
      hooks: { change: new SyncHook<[]>() },
    };
    const services = new Map<string, unknown>([
      ["camera", camera],
      ["scene", {
        container,
        input: { capturePointer, releasePointer },
      }],
      ["tool", { activeToolId: "hand" }],
    ]);
    createCameraControlPlugin().apply({
      hooks,
      services: {
        require: (name: string) => services.get(name),
      },
      config: {
        canvasId: "camera-test",
        tenant: LOCAL_BROWSER_TENANT_SCOPE,
      },
    } as never);

    hooks.init.call();
    hooks.pointerDown.call(pointerEvent({ type: "pointer-down" }));
    hooks.pointerMove.call(pointerEvent());
    hooks.pointerUp.call(pointerEvent({ type: "pointer-up" }));

    expect(capturePointer).toHaveBeenCalledWith(
      1,
      "camera-control:hand",
    );
    expect(pan).toHaveBeenCalledWith(-12, 8);
    expect(releasePointer).toHaveBeenCalledWith(
      1,
      "camera-control:hand",
    );

    hooks.pointerWheel.call(pointerEvent({
      type: "wheel",
      delta: { x: 4, y: 10 },
      modifiers: {
        alt: false,
        control: false,
        meta: false,
        shift: false,
      },
    }));
    expect(pan).toHaveBeenLastCalledWith(4, 10);
    hooks.pointerWheel.call(pointerEvent({
      type: "wheel",
      viewport: { x: 40, y: 50 },
      delta: { x: 0, y: -10 },
      modifiers: {
        alt: false,
        control: true,
        meta: false,
        shift: false,
      },
    }));
    expect(zoomAtScreenPoint).toHaveBeenCalledWith(
      2 * 1.03,
      { x: 40, y: 50 },
    );
    expect(container.querySelector("#hand-layer")).toBeNull();

    hooks.destroy.call();
    container.remove();
  });

  it("normalizes malformed persisted values and clamps zoom", () => {
    expect(fnNormalizeCameraState({ value: null })).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
    expect(fnNormalizeCameraState({
      value: { x: 10, y: -20, zoom: 100 },
    })).toEqual({ x: 10, y: -20, zoom: MAX_CAMERA_ZOOM });
    expect(fnNormalizeCameraState({
      value: { x: 10, y: -20, zoom: 0.001 },
    })).toEqual({ x: 10, y: -20, zoom: MIN_CAMERA_ZOOM });
  });
});
