import { ManualClock } from "@omnidraw/cangine/testing";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CanvasEngineAdapter } from "../../../src/engine/CanvasEngineAdapter";
import type { TCanvasInputEvent } from "../../../src/engine/input/typed";
import {
  createTestContainer,
  ensureRangeGeometryMocks,
} from "../../test-setup";
import { CanvasEngineTestFactory } from "../engine-test-backend";

function nativePointer(
  type: "pointerdown" | "pointerup" | "pointercancel" | "lostpointercapture",
  pointerId: number,
  buttons: number,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: "mouse" },
    clientX: { value: 20 },
    clientY: { value: 30 },
    buttons: { value: buttons },
    button: { value: type === "pointercancel" ? -1 : 0 },
    pressure: { value: buttons === 0 ? 0 : 0.5 },
    tiltX: { value: 0 },
    tiltY: { value: 0 },
    altKey: { value: false },
    ctrlKey: { value: false },
    metaKey: { value: false },
    shiftKey: { value: false },
  });
  return event;
}

describe("Cangine pointer-cancel reconciliation boundary", () => {
  let host: HTMLDivElement;
  let adapter: CanvasEngineAdapter | null;
  let captured: Set<number>;

  beforeEach(() => {
    ensureRangeGeometryMocks();
    vi.useFakeTimers();
    class TestResizeObserver {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    host = createTestContainer({ width: 400, height: 300 });
    captured = new Set();
    Object.defineProperties(host, {
      setPointerCapture: {
        configurable: true,
        value: (pointerId: number) => captured.add(pointerId),
      },
      hasPointerCapture: {
        configurable: true,
        value: (pointerId: number) => captured.has(pointerId),
      },
      releasePointerCapture: {
        configurable: true,
        value: (pointerId: number) => captured.delete(pointerId),
      },
    });
    adapter = null;
  });

  afterEach(async () => {
    await adapter?.destroy();
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("recovers an early loss and emits exactly one cancel after timeout", async () => {
    adapter = new CanvasEngineAdapter({
      host,
      engineConfig: {
        backendFactories: [new CanvasEngineTestFactory()],
        clock: new ManualClock(),
      },
    });
    await adapter.start();
    const input = adapter.createInputAdapter({
      getProjectionIndex: () => null,
      getDocument: () => ({
        id: "canvas",
        name: "Canvas",
        elements: {},
        groups: {},
      }),
      worldToViewport: (point) => point,
    });
    const events: TCanvasInputEvent[] = [];
    input.subscribe((event) => {
      events.push(event);
      if (event.type === "pointer-down") {
        return { handled: true, capturePointer: true };
      }
      return undefined;
    });

    host.dispatchEvent(nativePointer("pointerdown", 1, 1));
    captured.delete(1);
    host.dispatchEvent(nativePointer("lostpointercapture", 1, 0));
    host.dispatchEvent(nativePointer("pointerup", 1, 0));
    vi.advanceTimersByTime(51);

    expect(events.map((event) => event.type)).toEqual([
      "pointer-down",
      "pointer-up",
    ]);

    host.dispatchEvent(nativePointer("pointerdown", 2, 1));
    captured.delete(2);
    host.dispatchEvent(nativePointer("lostpointercapture", 2, 0));
    vi.advanceTimersByTime(51);
    host.dispatchEvent(nativePointer("pointerup", 2, 0));

    expect(events.filter((event) => {
      return event.type === "pointer-cancel" && event.pointerId === 2;
    })).toHaveLength(1);

    host.dispatchEvent(nativePointer("pointerdown", 3, 1));
    host.dispatchEvent(nativePointer("pointercancel", 3, 0));
    vi.advanceTimersByTime(51);
    expect(events.filter((event) => {
      return event.type === "pointer-cancel" && event.pointerId === 3;
    })).toHaveLength(1);

    input.destroy();
  });
});
