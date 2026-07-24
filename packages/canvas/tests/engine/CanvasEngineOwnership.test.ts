import {
  IDENTITY_TRANSFORM_2D,
  type TCanvasEngineConfig,
  type THtmlPortalNode,
  type TRectNode,
  type TSceneSnapshot,
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
import { CanvasEngineAdapter } from "../../src/engine/CanvasEngineAdapter";
import { CANVAS_ENGINE_LAYER_IDS } from "../../src/engine/CONSTANTS";
import {
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
} from "../test-setup";
import { CanvasEngineTestFactory } from "./engine-test-backend";

function setHostRect(host: HTMLDivElement): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    }),
  });
}

function portalNode(id: string, portalId: string): THtmlPortalNode {
  return {
    id,
    parentId: CANVAS_ENGINE_LAYER_IDS.content,
    orderKey: "A",
    kind: "html-portal",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 40, y: 50 },
    },
    portalId,
    size: { width: 240, height: 160 },
    interactive: true,
    clipContent: true,
  };
}

function rect(
  id: string,
  parentId: string | null = CANVAS_ENGINE_LAYER_IDS.content,
): TRectNode {
  return {
    id,
    parentId,
    orderKey: "A",
    kind: "rect",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 10, y: 20 },
    },
    size: { width: 100, height: 60 },
  };
}

function append(
  snapshot: TSceneSnapshot,
  ...nodes: TSceneSnapshot["nodes"]
): TSceneSnapshot {
  return {
    ...snapshot,
    rootLayerIds: [...snapshot.rootLayerIds],
    nodes: [...snapshot.nodes, ...nodes],
  };
}

describe("canvas engine ownership boundaries", () => {
  let host: HTMLDivElement;
  let adapter: CanvasEngineAdapter;
  let factory: CanvasEngineTestFactory;

  beforeEach(async () => {
    ensureDom();
    ensureRangeGeometryMocks();
    class ResizeObserverStub {
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    host = createTestContainer({ width: 800, height: 600 }) as HTMLDivElement;
    setHostRect(host);
    factory = new CanvasEngineTestFactory();
    const engineConfig: TCanvasEngineConfig = {
      host,
      renderProfile: {
        vector2D: "webgl2",
        threeD: "disabled",
        portals: "dom",
      },
      backendFactories: [factory],
      clock: new ManualClock(),
    };
    adapter = new CanvasEngineAdapter({
      host,
      engineConfig: {
        backendFactories: engineConfig.backendFactories,
        clock: engineConfig.clock,
      },
    });
    await adapter.start();
  });

  afterEach(async () => {
    await adapter.destroy();
    host.remove();
    vi.unstubAllGlobals();
  });

  it("shares resources, preserves old identity, and rolls prepared additions back", async () => {
    const imageA = {
      descriptor: {
        id: "vc:image:a",
        type: "image",
      },
    } as const;

    await adapter.resources.sync("element:a", [imageA]);
    await adapter.resources.sync("element:b", [imageA]);
    expect(adapter.resources.state("vc:image:a")).toMatchObject({
      refCount: 2,
    });

    await adapter.resources.release("element:a");
    expect(adapter.resources.state("vc:image:a")?.refCount).toBe(1);
    expect(() => adapter.resources.stage("element:b", [{
      descriptor: {
        ...imageA.descriptor,
        url: "https://assets.invalid/replacement.png",
      },
      source: {
        type: "url",
        url: "https://assets.invalid/replacement.png",
      },
    }])).toThrow(/changed descriptor or source/);
    expect(adapter.resources.state("vc:image:a")?.descriptor).toEqual(
      imageA.descriptor,
    );

    const staged = adapter.resources.stage("element:staged", [{
      descriptor: { id: "vc:image:staged", type: "image" },
    }]);
    await staged.prepare();
    expect(adapter.resources.state("vc:image:staged")).not.toBeNull();
    await staged.rollback();
    expect(staged.state).toBe("rolled-back");
    expect(adapter.resources.state("vc:image:staged")).toBeNull();

    await adapter.resources.release("element:b");
    expect(adapter.resources.state("vc:image:a")).toBeNull();
    expect(adapter.resources.resourceCount).toBe(0);
  });

  it("mounts portals through a canvas-owned context and disposes after scene removal", async () => {
    const mountContexts: unknown[] = [];
    let cleanupCount = 0;
    const mount = (context: { portalId: string; host: HTMLDivElement }) => {
      mountContexts.push(context);
      context.host.textContent = "Owned widget";
      return () => {
        cleanupCount += 1;
      };
    };
    const stage = adapter.portals.stage("element:widget", [{
      portalId: "vc:portal:widget",
      registrationKey: "widget-binding-v1",
      interactive: true,
      mount,
    }]);
    const result = await adapter.applyScene({
      snapshot: append(
        adapter.sceneSnapshot(),
        portalNode("vc:element:widget:portal", "vc:portal:widget"),
      ),
      stages: [stage],
      render: "none",
    });
    expect(result.ok).toBe(true);

    adapter.portals.syncNow("vc:portal:widget");
    await Promise.resolve();
    expect(adapter.portals.state("vc:portal:widget")).toMatchObject({
      nodeId: "vc:element:widget:portal",
      mounted: true,
      visible: true,
    });
    expect(mountContexts).toHaveLength(1);
    expect(Object.keys(mountContexts[0] as object).sort()).toEqual([
      "host",
      "portalId",
    ]);
    expect(host.textContent).toContain("Owned widget");

    expect(() => adapter.portals.stage("element:widget", [{
      portalId: "vc:portal:widget",
      registrationKey: "widget-binding-v2",
      mount,
    }])).toThrow(/changed its mount registration/);

    const withoutPortal = {
      ...adapter.sceneSnapshot(),
      nodes: adapter.sceneSnapshot().nodes.filter((node) => {
        return node.id !== "vc:element:widget:portal";
      }),
    };
    const release = adapter.portals.stage("element:widget", []);
    await expect(adapter.applyScene({
      snapshot: withoutPortal,
      stages: [release],
      render: "none",
    })).resolves.toMatchObject({ ok: true });
    await Promise.resolve();
    expect(adapter.portals.has("vc:portal:widget")).toBe(false);
    expect(cleanupCount).toBe(1);
  });

  it("rolls staged resources and portals back when the scene cannot commit", async () => {
    const resourceStage = adapter.resources.stage("element:new", [{
      descriptor: { id: "vc:image:new", type: "image" },
    }]);
    const portalStage = adapter.portals.stage("element:new", [{
      portalId: "vc:portal:new",
      registrationKey: "new-widget",
      mount: () => undefined,
    }]);
    const invalid = append(adapter.sceneSnapshot(), rect("invalid"));
    invalid.nodes.at(-1)!.transform.position.x = Number.NaN;

    const result = await adapter.applyScene({
      snapshot: invalid,
      stages: [resourceStage, portalStage],
      render: "none",
    });

    expect(result).toMatchObject({
      ok: false,
      fatal: false,
      restored: true,
    });
    expect(resourceStage.state).toBe("rolled-back");
    expect(portalStage.state).toBe("rolled-back");
    expect(adapter.resources.state("vc:image:new")).toBeNull();
    expect(adapter.portals.has("vc:portal:new")).toBe(false);
    expect(adapter.sceneSnapshot().nodes.some((node) => node.id === "invalid")).toBe(
      false,
    );
  });

  it("owns atomic transient replacement and durable handoff cleanup", async () => {
    adapter.transients.sync("vc:transient:clone:session", {
      band: "world-overlay",
      hitTest: "none",
      nodes: [rect("vc:clone:one", null)],
    });
    expect(adapter.transients.ownerIds()).toEqual([
      "vc:transient:clone:session",
    ]);
    expect(adapter.metricsSnapshot()).toMatchObject({
      transientOwnerCount: 1,
      transientNodeCount: 1,
    });

    expect(() => adapter.transients.sync("vc:transient:clone:session", {
      band: "world-overlay",
      nodes: [{
        ...rect("vc:clone:invalid", null),
        transform: {
          ...IDENTITY_TRANSFORM_2D,
          position: { x: Number.NaN, y: 0 },
        },
      }],
    })).toThrow();
    expect(adapter.metricsSnapshot()).toMatchObject({
      transientOwnerCount: 1,
      transientNodeCount: 1,
    });

    await expect(adapter.applyScene({
      snapshot: append(
        adapter.sceneSnapshot(),
        rect("vc:clone:one"),
      ),
      render: "none",
    })).resolves.toMatchObject({ ok: true });
    expect(adapter.metricsSnapshot()).toMatchObject({
      transientOwnerCount: 1,
      transientNodeCount: 0,
    });

    adapter.transients.release("vc:transient:clone:session");
    expect(adapter.metricsSnapshot()).toMatchObject({
      transientOwnerCount: 0,
      transientNodeCount: 0,
    });
  });

  it("disposes outstanding resource, portal, and transient owners before the engine", async () => {
    let portalCleanupCount = 0;
    await adapter.resources.sync("element:retained", [{
      descriptor: { id: "vc:image:retained", type: "image" },
    }]);
    const portalStage = adapter.portals.stage("element:retained", [{
      portalId: "vc:portal:retained",
      registrationKey: "retained-widget",
      mount: () => () => {
        portalCleanupCount += 1;
      },
    }]);
    await adapter.applyScene({
      snapshot: append(
        adapter.sceneSnapshot(),
        portalNode("vc:element:retained:portal", "vc:portal:retained"),
      ),
      stages: [portalStage],
      render: "none",
    });
    adapter.portals.syncNow("vc:portal:retained");
    await Promise.resolve();
    adapter.transients.sync("vc:transient:retained:session", {
      band: "world-overlay",
      nodes: [rect("vc:transient:retained:node", null)],
    });

    expect(adapter.resources.resourceCount).toBe(1);
    expect(adapter.portals.portalCount).toBe(1);
    expect(adapter.transients.ownerCount).toBe(1);

    await adapter.destroy();

    expect(portalCleanupCount).toBe(1);
    expect(factory.pass.destroyCount).toBe(1);
    expect(host.childElementCount).toBe(0);
    expect(() => adapter.resources).toThrow(/destroyed/);
  });
});
