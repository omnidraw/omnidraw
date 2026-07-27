import {
  CanvasEngineError,
  IDENTITY_TRANSFORM_2D,
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
  type TCanvasEngineConfig,
  type TEngineEvent,
  type TRectNode,
  type TSceneSnapshot,
} from "@omnidraw/cangine";
import { ManualClock } from "@omnidraw/cangine/testing";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  CanvasEngineAdapter,
  type TCanvasEngineAdapterEvent,
} from "../../src/engine/CanvasEngineAdapter";
import { CANVAS_ENGINE_LAYER_IDS } from "../../src/engine/CONSTANTS";
import {
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
} from "../test-setup";
import { CanvasEngineTestFactory } from "./engine-test-backend";

function setHostRect(host: HTMLDivElement, width = 800, height = 600): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

function rect(id: string): TRectNode {
  return {
    id,
    parentId: CANVAS_ENGINE_LAYER_IDS.content,
    orderKey: "A",
    kind: "rect",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 20, y: 30 },
    },
    size: { width: 120, height: 80 },
  };
}

function withNode(snapshot: TSceneSnapshot, node: TRectNode): TSceneSnapshot {
  return {
    ...snapshot,
    rootLayerIds: [...snapshot.rootLayerIds],
    nodes: [...snapshot.nodes, node],
  };
}

describe("CanvasEngineAdapter", () => {
  let host: HTMLDivElement;
  let resizeDisconnectCount: number;

  beforeEach(() => {
    ensureDom();
    ensureRangeGeometryMocks();
    resizeDisconnectCount = 0;
    class TrackedResizeObserver {
      observe(): void {}
      disconnect(): void {
        resizeDisconnectCount += 1;
      }
    }
    vi.stubGlobal("ResizeObserver", TrackedResizeObserver);
    host = createTestContainer({ width: 800, height: 600 }) as HTMLDivElement;
    setHostRect(host);
  });

  afterEach(() => {
    host.remove();
    vi.unstubAllGlobals();
  });

  it("enforces config, owns lifecycle, forwards metrics, and tears down once", async () => {
    const factory = new CanvasEngineTestFactory();
    const clock = new ManualClock();
    const configs: TCanvasEngineConfig[] = [];
    const events: TCanvasEngineAdapterEvent[] = [];
    const adapter = new CanvasEngineAdapter({
      host,
      createEngine: async (config) => {
        configs.push(config);
        return createInfiniteCanvas(config);
      },
      engineConfig: {
        backendFactories: [factory],
        clock,
        accessibility: { maxExposedNodes: 32 },
        diagnostics: { traceTransactions: true },
      },
    });
    const unsubscribe = adapter.subscribe((event) => events.push(event));

    const firstStart = adapter.start();
    expect(adapter.start()).toBe(firstStart);
    await firstStart;

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      renderProfile: {
        vector2D: "webgl2",
        threeD: "disabled",
        portals: "dom",
      },
      accessibility: {
        enabled: true,
        exposeCanvasNodes: true,
        maxExposedNodes: 32,
      },
      diagnostics: {
        enabled: true,
        collectFrameMetrics: true,
        traceTransactions: true,
      },
    });
    expect(adapter.status).toBe("ready");
    expect(adapter.capabilities).toMatchObject({
      vector2D: "webgl2",
      threeD: "disabled",
      portals: "dom",
    });
    expect(adapter.sceneSnapshot().rootLayerIds).toEqual([
      CANVAS_ENGINE_LAYER_IDS.background,
      CANVAS_ENGINE_LAYER_IDS.content,
      CANVAS_ENGINE_LAYER_IDS.overlay,
      CANVAS_ENGINE_LAYER_IDS.debug,
    ]);

    adapter.resize({ width: 1024, height: 768 });
    expect(factory.pass.resizes.at(-1)?.cssSize).toEqual({
      width: 1024,
      height: 768,
    });
    adapter.suspend();
    expect(adapter.status).toBe("suspended");
    adapter.resume();
    expect(adapter.status).toBe("ready");

    const render = adapter.render();
    clock.advance(16);
    await render;
    expect(factory.pass.renderCount).toBeGreaterThan(0);
    expect(adapter.metricsSnapshot().frameCount).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "metrics")).toBe(true);

    factory.pass.reportContextLost();
    expect(adapter.status).toBe("context-lost");
    await expect(adapter.render()).rejects.toMatchObject({ code: "CONTEXT_LOST" });
    factory.pass.requestContextRestore();
    await vi.waitFor(() => {
      expect(adapter.status).toBe("ready");
    });
    expect(factory.pass.contextRestoreCount).toBe(1);
    expect(events.some((event) => event.type === "context-lost")).toBe(true);
    expect(events.some((event) => event.type === "context-restored")).toBe(true);

    unsubscribe();
    const firstDestroy = adapter.destroy();
    expect(adapter.destroy()).toBe(firstDestroy);
    await firstDestroy;
    expect(adapter.status).toBe("destroyed");
    expect(factory.pass.destroyCount).toBe(1);
    expect(clock.pendingFrameCount).toBe(0);
    expect(resizeDisconnectCount).toBe(1);
    expect(host.querySelector("[data-vibecanvas-surface]")).toBeNull();
    expect(host.querySelector("[data-vibecanvas-engine-fallback]")).toBeNull();
    expect(host.childElementCount).toBe(0);
  });

  it("keeps the authoritative scene unchanged after validation failure", async () => {
    const factory = new CanvasEngineTestFactory();
    const adapter = new CanvasEngineAdapter({
      host,
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });
    await adapter.start();

    const valid = withNode(adapter.sceneSnapshot(), rect("valid"));
    await expect(adapter.applyScene({
      snapshot: valid,
      render: "none",
    })).resolves.toMatchObject({ ok: true });
    const authoritative = adapter.sceneSnapshot();

    const invalid = cloneSnapshot(valid);
    const invalidRect = invalid.nodes.find((node) => node.id === "valid");
    if (invalidRect === undefined) {
      throw new Error("Test fixture lost the valid rectangle.");
    }
    invalidRect.transform.position.x = Number.NaN;

    const result = await adapter.applyScene({
      snapshot: invalid,
      render: "none",
    });
    expect(result).toMatchObject({
      ok: false,
      fatal: false,
    });
    expect(adapter.status).toBe("ready");
    expect(adapter.sceneSnapshot()).toEqual(authoritative);
    expect(adapter.diagnostics().at(-1)?.source).toBe("scene");
    await adapter.destroy();
  });

  it("keeps a committed scene authoritative after a recoverable publication error", async () => {
    const factory = new CanvasEngineTestFactory();
    let engine: IInfiniteCanvasEngine | null = null;
    let engineListener: ((event: TEngineEvent) => void) | null = null;
    const adapter = new CanvasEngineAdapter({
      host,
      createEngine: async (config) => {
        const created = await createInfiniteCanvas(config);
        const subscribe = created.subscribe.bind(created);
        vi.spyOn(created, "subscribe").mockImplementation((listener) => {
          engineListener = listener;
          return subscribe(listener);
        });
        engine = created;
        return created;
      },
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });
    await adapter.start();
    if (engine === null) {
      throw new Error("Test create-engine seam did not receive an engine.");
    }
    const scene = (engine as IInfiniteCanvasEngine).scene;
    const apply = scene.apply.bind(scene);
    vi.spyOn(scene, "apply").mockImplementationOnce((commands, options) => {
      apply(commands, options);
      engineListener?.({
        type: "error",
        error: new CanvasEngineError(
          "PORTAL_MOUNT_FAILED",
          "intentional recoverable presentation failure",
          { recoverable: true },
        ),
      });
    });

    const result = await adapter.applyCommands({
      commands: [{ type: "upsert", node: rect("recoverable-publication") }],
      render: "none",
    });

    expect(result).toMatchObject({ ok: true });
    expect(adapter.status).toBe("ready");
    expect(adapter.sceneSnapshot().nodes.some((node) => {
      return node.id === "recoverable-publication";
    })).toBe(true);
    expect(adapter.diagnostics().at(-1)).toMatchObject({
      code: "PORTAL_MOUNT_FAILED",
      recoverable: true,
    });
    await adapter.destroy();
  });

  it("applies one-node diffs without replacing the retained snapshot", async () => {
    const factory = new CanvasEngineTestFactory();
    let engine: IInfiniteCanvasEngine | null = null;
    const adapter = new CanvasEngineAdapter({
      host,
      createEngine: async (config) => {
        engine = await createInfiniteCanvas(config);
        return engine;
      },
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });
    await adapter.start();
    if (engine === null) {
      throw new Error("Test create-engine seam did not receive an engine.");
    }
    const scene = (engine as IInfiniteCanvasEngine).scene;
    const applySpy = vi.spyOn(scene, "apply");
    const replaceSpy = vi.spyOn(scene, "replace");

    await expect(adapter.applyCommands({
      commands: [{ type: "upsert", node: rect("incremental") }],
      render: "none",
    })).resolves.toMatchObject({ ok: true });
    factory.pass.changes.splice(0);
    applySpy.mockClear();
    replaceSpy.mockClear();

    const updated = rect("incremental");
    updated.transform.position = { x: 180, y: 220 };
    await expect(adapter.applyCommands({
      commands: [{ type: "upsert", node: updated }],
      source: "test:one-node-diff",
      render: "none",
    })).resolves.toMatchObject({ ok: true });

    expect(applySpy).toHaveBeenCalledOnce();
    expect(applySpy.mock.calls[0]?.[0]).toEqual([
      { type: "upsert", node: updated },
    ]);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(factory.pass.changes).toHaveLength(1);
    expect(factory.pass.changes[0]).toMatchObject({
      source: "test:one-node-diff",
      added: [],
      updated: ["incremental"],
      removed: [],
      reparented: [],
      reordered: [],
    });
    expect(adapter.sceneSnapshot().nodes.find((node) => {
      return node.id === "incremental";
    })?.transform.position).toEqual({ x: 180, y: 220 });

    await expect(adapter.applyCommands({
      commands: [{
        type: "replace-snapshot",
        snapshot: adapter.sceneSnapshot(),
      }],
    })).rejects.toThrow(/incremental commands only/);
    await adapter.destroy();
  });

  it("terminalizes the existing engine after a post-commit backend failure", async () => {
    const factory = new CanvasEngineTestFactory();
    const adapter = new CanvasEngineAdapter({
      host,
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });
    await adapter.start();
    factory.pass.failNextSceneApply = true;
    const result = await adapter.applyScene({
      snapshot: withNode(adapter.sceneSnapshot(), rect("backend-failure")),
      render: "none",
    });

    expect(result).toMatchObject({
      ok: false,
      fatal: true,
    });
    expect(adapter.status).toBe("failed");
    expect(() => adapter.sceneSnapshot()).toThrow(/failed/i);
    expect(
      host.querySelector("[data-vibecanvas-engine-fallback]")?.textContent,
    ).toContain("Canvas unavailable");
    await adapter.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it("rejects missing required capabilities and cleans partial initialization", async () => {
    const factory = new CanvasEngineTestFactory({
      unsupportedNodeKinds: ["path"],
    });
    const adapter = new CanvasEngineAdapter({
      host,
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });

    await expect(adapter.start()).rejects.toMatchObject({
      code: "CAPABILITY_MISMATCH",
    });
    expect(adapter.status).toBe("failed");
    expect(factory.pass.destroyCount).toBe(1);
    expect(resizeDisconnectCount).toBe(1);
    expect(
      host.querySelector("[data-vibecanvas-engine-fallback]")?.textContent,
    ).toContain("requiredNodeKinds");

    await adapter.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it("allows element-specific capability gaps for projection placeholders", async () => {
    const factory = new CanvasEngineTestFactory({
      unsupportedNodeKinds: ["image", "widget-frame", "html-portal"],
    });
    const adapter = new CanvasEngineAdapter({
      host,
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });

    await expect(adapter.start()).resolves.toBeUndefined();
    expect(adapter.status).toBe("ready");
    await adapter.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it("surfaces a fatal fallback when context restoration fails", async () => {
    const factory = new CanvasEngineTestFactory();
    factory.pass.failContextRestore = true;
    const adapter = new CanvasEngineAdapter({
      host,
      engineConfig: { backendFactories: [factory], clock: new ManualClock() },
    });
    await adapter.start();

    factory.pass.reportContextLost();
    factory.pass.requestContextRestore();
    await vi.waitFor(() => {
      expect(adapter.status).toBe("failed");
    });
    expect(
      host.querySelector("[data-vibecanvas-engine-fallback]")?.textContent,
    ).toContain("Canvas unavailable");
    expect(adapter.diagnostics().some((diagnostic) => {
      return diagnostic.recoverable === false;
    })).toBe(true);

    await adapter.destroy();
    expect(host.childElementCount).toBe(0);
  });
});

function cloneSnapshot(snapshot: TSceneSnapshot): TSceneSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as TSceneSnapshot;
}
