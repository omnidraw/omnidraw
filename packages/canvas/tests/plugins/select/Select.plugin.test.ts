import type { TCanvasProductMarqueeOptions } from "../../../src/engine/product-runtime/typed";
import { createSelectPlugin } from "../../../src/plugins/select/Select.plugin";
import { CanvasMode } from "../../../src/services/selection/CONSTANTS";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { describe, expect, it, vi } from "vitest";

class TestHook<TArgs extends unknown[]> {
  readonly listeners: Array<(...args: TArgs) => unknown> = [];

  tap(listener: (...args: TArgs) => unknown) {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  call(...args: TArgs) {
    for (const listener of [...this.listeners]) {
      listener(...args);
    }
  }
}

function hit(id: string, groupAncestry: readonly string[] = []) {
  return {
    target: { kind: "element" as const, id },
    part: "body" as const,
    groupAncestry,
    world: { x: 10, y: 10 },
    viewport: { x: 10, y: 10 },
  };
}

function pointerDown(shift = false) {
  return {
    type: "pointer-down",
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    world: { x: 0, y: 0 },
    viewport: { x: 0, y: 0 },
    client: { x: 0, y: 0 },
    pressure: 0,
    tilt: { x: 0, y: 0 },
    timeStamp: 1,
    modifiers: {
      alt: false,
      control: false,
      meta: false,
      shift,
    },
    hit: null,
  };
}

function harness() {
  const selection = new SelectionService({ now: () => 0 });
  const pointerDownHook = new TestHook<[ReturnType<typeof pointerDown>]>();
  const destroy = new TestHook<[]>();
  const keydown = new TestHook<[KeyboardEvent]>();
  const elementPointerDown = new TestHook<[never]>();
  const elementPointerDoubleClick = new TestHook<[never]>();
  let marqueeOptions: TCanvasProductMarqueeOptions | null = null;
  const beginMarquee = vi.fn((_event, options) => {
    marqueeOptions = options;
    options.onBegin?.({
      kind: "marquee",
      phase: "begin",
      start: pointerDown(),
      current: pointerDown(),
      worldBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      viewportBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      distanceViewport: 0,
    });
  });
  const cancel = vi.fn();
  const queryWorldRect = vi.fn(() => []);
  const services = new Map<string, unknown>([
    ["contextMenu", {
      registerProvider: vi.fn(() => vi.fn()),
    }],
    ["crdt", {
      doc: () => ({ elements: {}, groups: {} }),
    }],
    ["element", {}],
    ["history", {}],
    ["renderOrder", {}],
    ["scene", {
      input: { queryWorldRect },
      product: {
        interactions: { beginMarquee, cancel },
      },
    }],
    ["selection", selection],
  ]);

  createSelectPlugin().apply({
    hooks: {
      destroy,
      elementPointerDown,
      elementPointerDoubleClick,
      keydown,
      pointerDown: pointerDownHook,
    },
    services: {
      require: (name: string) => services.get(name),
    },
  } as never);

  return {
    beginMarquee,
    cancel,
    destroy,
    marqueeOptions: () => {
      if (marqueeOptions === null) {
        throw new Error("Marquee interaction did not start.");
      }
      return marqueeOptions;
    },
    pointerDown: pointerDownHook,
    queryWorldRect,
    selection,
  };
}

describe("Select plugin engine marquee", () => {
  it("uses the engine session for preview/update/commit and semantic selection", () => {
    const runtime = harness();
    runtime.selection.setSelection([{ kind: "element", id: "existing" }]);
    runtime.pointerDown.call(pointerDown(true));

    expect(runtime.beginMarquee).toHaveBeenCalledOnce();
    const options = runtime.marqueeOptions();
    runtime.queryWorldRect.mockReturnValue([
      hit("nested", ["outer", "inner"]),
    ]);
    options.onUpdate?.({
      kind: "marquee",
      phase: "update",
      start: pointerDown(true),
      current: pointerDown(true),
      worldBounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
      viewportBounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
      distanceViewport: 30,
    });

    expect(runtime.queryWorldRect).toHaveBeenCalledWith({
      rect: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
    });
    expect(runtime.selection.selection).toEqual([
      { kind: "element", id: "existing" },
      { kind: "group", id: "outer" },
    ]);

    options.onCommit({
      kind: "marquee",
      phase: "commit",
      start: pointerDown(true),
      current: pointerDown(true),
      worldBounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
      viewportBounds: { minX: 0, minY: 0, maxX: 20, maxY: 30 },
      distanceViewport: 30,
      hits: [hit("root")],
      belowThreshold: false,
    });
    expect(runtime.selection.selection).toEqual([
      { kind: "element", id: "existing" },
      { kind: "element", id: "root" },
    ]);
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("cancels the engine preview and restores the base selection on mode change", () => {
    const runtime = harness();
    runtime.selection.setSelection([{ kind: "element", id: "existing" }]);
    runtime.pointerDown.call(pointerDown(true));
    runtime.selection.setMode(CanvasMode.HAND);

    expect(runtime.cancel).toHaveBeenCalledOnce();
    expect(runtime.selection.selection).toEqual([
      { kind: "element", id: "existing" },
    ]);
  });

  it("preserves selection when Cangine rejects marquee for a transform handle", () => {
    const runtime = harness();
    runtime.beginMarquee.mockImplementationOnce(() => undefined);
    runtime.selection.setSelection([{ kind: "element", id: "existing" }]);

    runtime.pointerDown.call(pointerDown());

    expect(runtime.beginMarquee).toHaveBeenCalledOnce();
    expect(runtime.selection.selection).toEqual([
      { kind: "element", id: "existing" },
    ]);
  });
});
