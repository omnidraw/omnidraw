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
  type: "pointer-down" | "pointer-up",
  timeStamp: number,
): TCanvasInputEvent {
  return {
    type,
    pointerId: 1,
    button: 0,
    buttons: type === "pointer-down" ? 1 : 0,
    pointerType: "mouse",
    client: { x: 20, y: 30 },
    viewport: { x: 20, y: 30 },
    world: { x: 20, y: 30 },
    pressure: 0,
    tilt: { x: 0, y: 0 },
    deltaViewport: { x: 0, y: 0 },
    deltaWorld: { x: 0, y: 0 },
    hit: {
      target: { kind: "element", id: "one" },
      part: "body",
      groupAncestry: [],
      world: { x: 20, y: 30 },
      viewport: { x: 20, y: 30 },
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

describe("EventListener plugin", () => {
  beforeEach(() => {
    ensureDom();
  });

  it("bridges normalized pointer input and filters editable keyboard targets", () => {
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
    const pointerDown = vi.fn(() => true);
    const doubleClick = vi.fn();
    const keyDown = vi.fn();
    hooks.elementPointerDown.tap(pointerDown);
    hooks.elementPointerDoubleClick.tap(doubleClick);
    hooks.keydown.tap(keyDown);

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

    expect(inputListener).not.toBeNull();
    expect(inputListener?.(pointer("pointer-down", 10))).toEqual({
      handled: true,
      stopPropagation: true,
    });
    inputListener?.(pointer("pointer-up", 20));
    inputListener?.(pointer("pointer-up", 100));
    expect(pointerDown).toHaveBeenCalledOnce();
    expect(doubleClick).toHaveBeenCalledOnce();

    container.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      bubbles: true,
    }));
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z",
      bubbles: true,
    }));
    expect(keyDown).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    hooks.destroy.call();
    expect(inputListener).toBeNull();
    expect(blur).toHaveBeenCalledOnce();
    container.remove();
  });
});
