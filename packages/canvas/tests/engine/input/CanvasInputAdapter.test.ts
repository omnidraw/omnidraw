import type {
  IInputController,
  TClickInputEvent,
  TAabb,
  THitResult,
  THitTestOptions,
  TInputDisposition,
  TInputEvent,
  TKeyInputEvent,
  TPointerInputEvent,
  TVec2,
  TWheelInputEvent,
} from "@omnidraw/cangine";
import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { describe, expect, it, vi } from "vitest";
import { CanvasInputAdapter } from "../../../src/engine/input/CanvasInputAdapter";
import { CanvasTransientTargetRegistry } from "../../../src/engine/input/CanvasTransientTargetRegistry";
import type { TCanvasProjectionIndex } from "../../../src/engine/typed";

type TEngineListener = (
  event: TInputEvent,
) => TInputDisposition | void;

function element(id: string): TElement {
  return {
    id,
    x: 0,
    y: 0,
    rotation: 0,
    zIndex: "z00000001",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: { type: "rect", w: 10, h: 10 },
    style: {},
  };
}

function document(...ids: string[]): TCanvasDoc {
  return {
    id: "canvas",
    name: "Canvas",
    elements: Object.fromEntries(ids.map((id) => [id, element(id)])),
    groups: {},
  };
}

function index(...ids: string[]): TCanvasProjectionIndex {
  return {
    elementNodeIds: Object.fromEntries(
      ids.map((id) => [id, [`node:${id}`]]),
    ),
    groupNodeIds: {},
    nodeTargets: Object.fromEntries(
      ids.map((id) => [`node:${id}`, { kind: "element", id }]),
    ),
    elementResourceIds: {},
    elementPortalIds: {},
    elementSignatures: {},
    groupSignatures: {},
    activeProjectionSignature: "projection",
    lastAppliedRevision: 1,
  };
}

function hit(id: string): THitResult {
  return {
    nodeId: `node:${id}`,
    path: [`node:${id}`],
    worldPoint: { x: 5, y: 7 },
    localPoint: { x: 5, y: 7 },
    zOrder: 1,
  };
}

function pointerEvent(id: string): TPointerInputEvent {
  return {
    type: "pointer-down",
    timeStamp: 10,
    modifiers: { alt: true, ctrl: true, meta: false, shift: true },
    pointerId: 7,
    pointerType: "pen",
    buttons: 1,
    button: 0,
    pressure: 0.6,
    tilt: { x: 2, y: 3 },
    client: { x: 12, y: 14 },
    viewport: { x: 10, y: 11 },
    world: { x: 5, y: 7 },
    deltaViewport: { x: 1, y: 2 },
    deltaWorld: { x: 0.5, y: 1 },
    hit: hit(id),
  };
}

function wheelEvent(id: string): TWheelInputEvent {
  return {
    type: "wheel",
    timeStamp: 11,
    modifiers: { alt: false, ctrl: false, meta: true, shift: false },
    client: { x: 12, y: 14 },
    viewport: { x: 10, y: 11 },
    world: { x: 5, y: 7 },
    delta: { x: 0, y: 120 },
    deltaMode: "line",
    hit: hit(id),
  };
}

function keyEvent(): TKeyInputEvent {
  return {
    type: "key-down",
    timeStamp: 12,
    modifiers: { alt: false, ctrl: true, meta: false, shift: true },
    key: "z",
    code: "KeyZ",
    repeat: false,
    composing: true,
  };
}

function inputHarness() {
  let listener: TEngineListener | null = null;
  let clickListener: ((event: TClickInputEvent) => void) | null = null;
  let worldHits: THitResult[] = [];
  let viewportHits: THitResult[] = [];
  let rectHits: THitResult[] = [];
  const unsubscribe = vi.fn();
  const unsubscribeClicks = vi.fn();
  const destroyClicks = vi.fn();
  const subscribe = vi.fn((next: TEngineListener) => {
    listener = next;
    return unsubscribe;
  });
  const input: IInputController = {
    subscribe,
    createClickRecognizer: vi.fn(() => ({
      subscribe(next) {
        clickListener = next;
        return unsubscribeClicks;
      },
      reset: vi.fn(),
      destroy: destroyClicks,
    })),
    hitTestViewport: vi.fn((_point: TVec2, _options?: THitTestOptions) => {
      return viewportHits;
    }),
    hitTestWorld: vi.fn((_point: TVec2, _options?: THitTestOptions) => {
      return worldHits;
    }),
    queryWorldRect: vi.fn((_rect: TAabb, _options?: THitTestOptions) => {
      return rectHits;
    }),
    queryWorldPolygon: vi.fn(() => []),
    capturePointer: vi.fn(),
    releasePointer: vi.fn(),
    focus: vi.fn(),
    blur: vi.fn(),
  };
  return {
    input,
    subscribe,
    unsubscribe,
    unsubscribeClicks,
    destroyClicks,
    emit(event: TInputEvent) {
      return listener?.(event);
    },
    emitClick(event: TClickInputEvent) {
      clickListener?.(event);
    },
    setWorldHits(hits: THitResult[]) {
      worldHits = hits;
    },
    setViewportHits(hits: THitResult[]) {
      viewportHits = hits;
    },
    setRectHits(hits: THitResult[]) {
      rectHits = hits;
    },
  };
}

describe("CanvasInputAdapter", () => {
  it("subscribes to the engine once and normalizes pointer, wheel, and key DTOs", () => {
    const harness = inputHarness();
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => ({ x: point.x * 2, y: point.y * 2 }),
    });
    const received: unknown[] = [];
    adapter.subscribe((event) => {
      received.push(event);
    });
    adapter.subscribe(() => undefined);

    harness.emit(pointerEvent("first"));
    harness.emit(wheelEvent("first"));
    harness.emit(keyEvent());

    expect(harness.subscribe).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({
      type: "pointer-down",
      pointerId: 7,
      pointerType: "pen",
      pressure: 0.6,
      modifiers: {
        alt: true,
        control: true,
        meta: false,
        shift: true,
      },
      hit: {
        target: { kind: "element", id: "first" },
        world: { x: 5, y: 7 },
        viewport: { x: 10, y: 11 },
      },
    });
    expect(received[0]).not.toHaveProperty("nativeEvent");
    expect(received[1]).toMatchObject({
      type: "wheel",
      delta: { x: 0, y: 120 },
      deltaMode: "line",
      modifiers: { meta: true },
    });
    expect(received[2]).toMatchObject({
      type: "key-down",
      key: "z",
      code: "KeyZ",
      composing: true,
      modifiers: { control: true, shift: true },
    });
  });

  it("normalizes engine-recognized clicks and preserves click suppression", () => {
    const harness = inputHarness();
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => point,
    });
    const clicks: unknown[] = [];
    adapter.subscribeClicks((event) => clicks.push(event));
    adapter.subscribe(() => ({ suppressClick: true }));

    expect(harness.emit(pointerEvent("first"))).toMatchObject({
      suppressClick: true,
    });
    const pointer = pointerEvent("first");
    harness.emitClick({
      type: "click",
      timeStamp: pointer.timeStamp,
      modifiers: pointer.modifiers,
      pointerId: pointer.pointerId,
      pointerType: pointer.pointerType,
      button: pointer.button,
      client: pointer.client,
      viewport: pointer.viewport,
      world: pointer.world,
      hit: pointer.hit,
    });
    expect(clicks).toEqual([
      expect.objectContaining({
        type: "click",
        hit: expect.objectContaining({
          target: { kind: "element", id: "first" },
        }),
      }),
    ]);
  });

  it("aggregates disposition and preserves capture/release intent", () => {
    const harness = inputHarness();
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => point,
    });
    const skipped = vi.fn();
    adapter.subscribe(() => ({
      handled: true,
      capturePointer: true,
    }));
    adapter.subscribe(() => ({
      preventDefault: true,
      releasePointer: true,
      stopPropagation: true,
    }));
    adapter.subscribe(skipped);

    expect(harness.emit(pointerEvent("first"))).toMatchObject({
      handled: true,
      preventDefault: true,
      stopPropagation: true,
      capturePointer: false,
      releasePointer: true,
    });
    expect(skipped).not.toHaveBeenCalled();
  });

  it("reports listener failures and continues dispatching remaining listeners", () => {
    const harness = inputHarness();
    const onError = vi.fn();
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => point,
      onError,
    });
    const failure = new Error("listener failed");
    adapter.subscribe(() => {
      throw failure;
    });
    const survivingListener = vi.fn(() => ({
      handled: true,
      preventDefault: true,
    }));
    adapter.subscribe(survivingListener);

    expect(harness.emit(pointerEvent("first"))).toMatchObject({
      handled: true,
      preventDefault: true,
    });
    expect(survivingListener).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure, {
      operation: "listener",
    });
  });

  it("uses current index/document providers and deduplicates query results", () => {
    const harness = inputHarness();
    let currentIndex = index("first");
    let currentDocument = document("first");
    harness.setWorldHits([hit("first"), hit("first")]);
    harness.setViewportHits([hit("first")]);
    harness.setRectHits([hit("first"), hit("first")]);
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => currentIndex,
      getDocument: () => currentDocument,
      worldToViewport: (point) => ({ x: point.x + 100, y: point.y + 200 }),
    });

    expect(adapter.hitTestWorld({ point: { x: 5, y: 7 } })).toHaveLength(1);
    expect(adapter.hitTestViewport({ point: { x: 105, y: 207 } })[0])
      .toMatchObject({
        target: { kind: "element", id: "first" },
        viewport: { x: 105, y: 207 },
      });
    expect(adapter.queryWorldRect({
      rect: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    })).toHaveLength(1);

    currentIndex = index("second");
    currentDocument = document("second");
    harness.setWorldHits([hit("second")]);
    expect(adapter.hitTestWorld({ point: { x: 5, y: 7 } })[0]?.target)
      .toEqual({ kind: "element", id: "second" });
    const events: unknown[] = [];
    adapter.subscribe((event) => {
      events.push(event);
    });
    harness.emit(pointerEvent("second"));
    expect(events[0]).toMatchObject({
      hit: { target: { kind: "element", id: "second" } },
    });
  });

  it("injects transient-owner resolution into normalized events and queries", () => {
    const harness = inputHarness();
    const registry = new CanvasTransientTargetRegistry();
    const release = registry.register("selection-owner", {
      kind: "element",
      id: "first",
    });
    const transientHit: THitResult = {
      ...hit("unindexed"),
      nodeId: "transient:resize:se",
      path: ["transient:root", "transient:resize:se"],
      transientOwnerId: "selection-owner",
      part: "resize:se",
    };
    harness.setWorldHits([transientHit]);
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => point,
      resolveTransientTarget: registry.resolve,
    });
    const received: unknown[] = [];
    adapter.subscribe((event) => {
      received.push(event);
    });

    expect(adapter.hitTestWorld({ point: { x: 5, y: 7 } })[0]).toMatchObject({
      target: { kind: "element", id: "first" },
      part: "resize-handle",
      transient: {
        ownerId: "selection-owner",
        handleId: "resize:se",
      },
    });
    harness.emit({
      ...pointerEvent("first"),
      hit: transientHit,
    });
    expect(received[0]).toMatchObject({
      hit: {
        target: { kind: "element", id: "first" },
        transient: { ownerId: "selection-owner" },
      },
    });

    release();
    expect(adapter.hitTestWorld({ point: { x: 5, y: 7 } })).toEqual([]);
  });

  it("owns explicit capture, focus, subscription teardown, and destroy idempotently", () => {
    const harness = inputHarness();
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => point,
    });
    adapter.capturePointer(1, "drag");
    adapter.capturePointer(1, "drag");
    adapter.capturePointer(2, "resize");
    adapter.releasePointer(2, "other");
    adapter.focus();
    adapter.focus();

    expect(harness.input.capturePointer).toHaveBeenCalledTimes(2);
    expect(harness.input.focus).toHaveBeenCalledTimes(1);
    adapter.destroy();
    adapter.destroy();

    expect(harness.input.releasePointer).toHaveBeenCalledTimes(2);
    expect(harness.input.releasePointer).toHaveBeenCalledWith(1, "drag");
    expect(harness.input.releasePointer).toHaveBeenCalledWith(2, "resize");
    expect(harness.input.blur).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribeClicks).toHaveBeenCalledTimes(1);
    expect(harness.destroyClicks).toHaveBeenCalledTimes(1);
    expect(() => adapter.focus()).toThrow("destroyed");
  });

  it("finishes destroy cleanup when release, blur, diagnostics, or unsubscribe throw", () => {
    const harness = inputHarness();
    const releaseFailure = new Error("release failed");
    const blurFailure = new Error("blur failed");
    const unsubscribeFailure = new Error("unsubscribe failed");
    vi.mocked(harness.input.releasePointer).mockImplementation(
      (pointerId) => {
        if (pointerId === 1) {
          throw releaseFailure;
        }
      },
    );
    vi.mocked(harness.input.blur).mockImplementation(() => {
      throw blurFailure;
    });
    harness.unsubscribe.mockImplementation(() => {
      throw unsubscribeFailure;
    });
    const diagnostics: Array<{
      error: unknown;
      operation: string;
    }> = [];
    const adapter = new CanvasInputAdapter({
      input: harness.input,
      getProjectionIndex: () => index("first"),
      getDocument: () => document("first"),
      worldToViewport: (point) => point,
      onError(error, diagnostic) {
        diagnostics.push({ error, operation: diagnostic.operation });
        if (diagnostic.operation === "release-pointer") {
          throw new Error("diagnostics failed");
        }
      },
    });
    adapter.capturePointer(1, "drag");
    adapter.capturePointer(2, "resize");
    adapter.focus();

    expect(() => adapter.destroy()).not.toThrow();
    expect(() => adapter.destroy()).not.toThrow();
    expect(harness.input.releasePointer).toHaveBeenCalledWith(1, "drag");
    expect(harness.input.releasePointer).toHaveBeenCalledWith(2, "resize");
    expect(harness.input.blur).toHaveBeenCalledTimes(1);
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
    expect(diagnostics).toEqual([
      { error: releaseFailure, operation: "release-pointer" },
      { error: blurFailure, operation: "blur" },
      { error: unsubscribeFailure, operation: "unsubscribe" },
    ]);
  });
});
