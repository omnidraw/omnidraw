import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  TCanvasInputEvent,
  TCanvasInputListener,
  TCanvasInputPointerEvent,
} from "../../../src/engine/input/typed";
import { createEventListenerPlugin } from "../../../src/plugins/event-listener/EventListener.plugin";
import { ensureDom } from "../../test-setup";

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];
  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => true;
  }
  call(...args: TArgs): unknown {
    let result: unknown;
    for (const listener of this.listeners) {
      result = listener(...args) ?? result;
    }
    return result;
  }
}

function pointer(
  type: TCanvasInputPointerEvent["type"],
  timeStamp: number,
  options: {
    pointerId?: number;
    pointerType?: TCanvasInputPointerEvent["pointerType"];
    button?: number;
    viewport?: { x: number; y: number };
    targetId?: string | null;
  } = {},
): TCanvasInputEvent {
  const viewport = options.viewport ?? { x: 20, y: 30 };
  const targetId = options.targetId === undefined ? "one" : options.targetId;
  return {
    type,
    pointerId: options.pointerId ?? 1,
    button: options.button ?? 0,
    buttons: type === "pointer-down" ? 1 : 0,
    pointerType: options.pointerType ?? "mouse",
    client: { ...viewport },
    viewport: { ...viewport },
    world: { ...viewport },
    pressure: 0,
    tilt: { x: 0, y: 0 },
    deltaViewport: { x: 0, y: 0 },
    deltaWorld: { x: 0, y: 0 },
    hit: targetId === null
      ? null
      : {
          target: { kind: "element", id: targetId },
          part: "body",
          groupAncestry: [],
          world: { ...viewport },
          viewport: { ...viewport },
        },
    timeStamp,
    modifiers: {
      alt: false,
      control: false,
      meta: false,
      shift: false,
    },
  };
}

function harness() {
  const container = document.createElement("div");
  const input = document.createElement("input");
  container.appendChild(input);
  document.body.appendChild(container);
  let inputListener: TCanvasInputListener | null = null;
  const focus = vi.fn();
  const blur = vi.fn();
  const hooks = {
    init: new TestHook<[]>(),
    destroy: new TestHook<[]>(),
    pointerDown: new TestHook<[unknown]>(),
    pointerUp: new TestHook<[unknown]>(),
    pointerOut: new TestHook<[unknown]>(),
    pointerOver: new TestHook<[unknown]>(),
    pointerMove: new TestHook<[unknown]>(),
    pointerWheel: new TestHook<[unknown]>(),
    pointerCancel: new TestHook<[unknown]>(),
    keydown: new TestHook<[KeyboardEvent]>(),
    keyup: new TestHook<[KeyboardEvent]>(),
    elementPointerClick: new TestHook<[unknown]>(),
    elementPointerDown: new TestHook<[unknown]>(),
    elementPointerDoubleClick: new TestHook<[unknown]>(),
  };
  const click = vi.fn();
  const doubleClick = vi.fn();
  hooks.elementPointerClick.tap(click);
  hooks.elementPointerDoubleClick.tap(doubleClick);

  createEventListenerPlugin().apply({
    hooks,
    services: {
      require: () => ({
        container,
        input: {
          subscribe: (listener: TCanvasInputListener) => {
            inputListener = listener;
            return () => {
              inputListener = null;
            };
          },
          focus,
          blur,
          hitTestViewport: () => [],
        },
      }),
    },
    config: {},
  } as never);
  hooks.init.call();
  return {
    blur,
    click,
    container,
    doubleClick,
    focus,
    hooks,
    input,
    emit(event: TCanvasInputEvent) {
      return inputListener?.(event);
    },
    hasInputListener() {
      return inputListener !== null;
    },
    destroy() {
      hooks.destroy.call();
      container.remove();
    },
  };
}

describe("EventListener plugin", () => {
  beforeEach(() => {
    ensureDom();
  });

  it("bridges matched pointer input and filters editable keyboard targets", () => {
    const test = harness();
    const pointerDown = vi.fn(() => true);
    const keyDown = vi.fn();
    test.hooks.elementPointerDown.tap(pointerDown);
    test.hooks.keydown.tap(keyDown);

    expect(test.hasInputListener()).toBe(true);
    expect(test.emit(pointer("pointer-down", 10))).toEqual({
      handled: true,
      stopPropagation: true,
    });
    test.emit(pointer("pointer-up", 20));
    test.emit(pointer("pointer-down", 90));
    test.emit(pointer("pointer-up", 100));
    expect(pointerDown).toHaveBeenCalledTimes(2);
    expect(test.click).toHaveBeenCalledTimes(2);
    expect(test.doubleClick).toHaveBeenCalledOnce();

    test.container.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      bubbles: true,
    }));
    test.input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      bubbles: true,
    }));
    expect(keyDown).toHaveBeenCalledOnce();
    expect(test.focus).toHaveBeenCalledOnce();

    test.destroy();
    expect(test.hasInputListener()).toBe(false);
    expect(test.blur).toHaveBeenCalledOnce();
  });

  it("rejects unmatched, moved, cancelled, late, and retargeted releases", () => {
    const test = harness();

    test.emit(pointer("pointer-up", 10));
    test.emit(pointer("pointer-down", 20));
    test.emit(pointer("pointer-move", 30, {
      viewport: { x: 40, y: 30 },
    }));
    test.emit(pointer("pointer-up", 40, {
      viewport: { x: 40, y: 30 },
    }));
    test.emit(pointer("pointer-down", 50));
    test.emit(pointer("pointer-cancel", 60));
    test.emit(pointer("pointer-up", 70));
    test.emit(pointer("pointer-down", 80, { pointerId: 1 }));
    test.emit(pointer("pointer-up", 90, { pointerId: 2 }));
    test.emit(pointer("pointer-down", 100));
    test.emit(pointer("pointer-up", 110, { targetId: "two" }));
    test.emit(pointer("pointer-down", 200));
    test.emit(pointer("pointer-up", 1_000));

    expect(test.click).not.toHaveBeenCalled();
    expect(test.doubleClick).not.toHaveBeenCalled();
    test.destroy();
  });

  it("accepts independently matched touch and pen clicks", () => {
    const test = harness();

    test.emit(pointer("pointer-down", 10, {
      pointerId: 7,
      pointerType: "touch",
    }));
    test.emit(pointer("pointer-up", 20, {
      pointerId: 7,
      pointerType: "touch",
    }));
    test.emit(pointer("pointer-down", 30, {
      pointerId: 9,
      pointerType: "pen",
    }));
    test.emit(pointer("pointer-up", 40, {
      pointerId: 9,
      pointerType: "pen",
    }));

    expect(test.click).toHaveBeenCalledTimes(2);
    expect(test.doubleClick).not.toHaveBeenCalled();
    test.destroy();
  });
});
