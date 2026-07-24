import {
  IDENTITY_TRANSFORM_2D,
  type TCanvasEngineConfig,
  type THtmlPortalNode,
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

  it("shares descriptor registrations and preserves old identity on conflicts", async () => {
    const imageA = {
      descriptor: {
        id: "vc:image:a",
        type: "image",
      },
    } as const;

    const ownerA = adapter.createResourceRegistrationOwner("element:a");
    const ownerB = adapter.createResourceRegistrationOwner("element:b");
    ownerA.replace([imageA]);
    ownerB.replace([imageA]);
    expect(adapter.metricsSnapshot().resourceCount).toBe(1);

    ownerA.clear();
    expect(adapter.metricsSnapshot().resourceCount).toBe(1);
    expect(() => ownerB.replace([{
      descriptor: {
        ...imageA.descriptor,
        url: "https://assets.invalid/replacement.png",
      },
    }])).toThrow(/incompatible|descriptor/i);
    expect(adapter.metricsSnapshot().resourceCount).toBe(1);

    ownerB.clear();
    expect(adapter.metricsSnapshot().resourceCount).toBe(0);
    ownerA.destroy();
    ownerB.destroy();
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
    await stage.prepare();
    const result = await adapter.applyScene({
      snapshot: append(
        adapter.sceneSnapshot(),
        portalNode("vc:element:widget:portal", "vc:portal:widget"),
      ),
      render: "none",
    });
    await stage.commit();
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
    await release.prepare();
    await expect(adapter.applyScene({
      snapshot: withoutPortal,
      render: "none",
    })).resolves.toMatchObject({ ok: true });
    await release.commit();
    await Promise.resolve();
    expect(adapter.portals.has("vc:portal:widget")).toBe(false);
    expect(cleanupCount).toBe(1);
  });

  it("rolls staged resources and portals back when the scene cannot commit", async () => {
    const resourceOwner = adapter.createResourceRegistrationOwner("element:new");
    resourceOwner.replace([{
      descriptor: { id: "vc:image:new", type: "image" },
    }]);
    const portalStage = adapter.portals.stage("element:new", [{
      portalId: "vc:portal:new",
      registrationKey: "new-widget",
      mount: () => undefined,
    }]);
    const invalid = append(adapter.sceneSnapshot(), rect("invalid"));
    invalid.nodes.at(-1)!.transform.position.x = Number.NaN;
    await portalStage.prepare();

    const result = await adapter.applyScene({
      snapshot: invalid,
      render: "none",
    });
    await portalStage.rollback();
    resourceOwner.clear();

    expect(result).toMatchObject({
      ok: false,
      fatal: false,
    });
    expect(portalStage.state).toBe("rolled-back");
    expect(adapter.metricsSnapshot().resourceCount).toBe(0);
    expect(adapter.portals.has("vc:portal:new")).toBe(false);
    expect(adapter.sceneSnapshot().nodes.some((node) => node.id === "invalid")).toBe(
      false,
    );
  });

  it("owns atomic transient replacement and durable handoff cleanup", async () => {
    await adapter.applyScene({
      snapshot: append(adapter.sceneSnapshot(), rect("vc:source:one")),
      render: "none",
    });
    const clone = adapter.transients.cloneFromScene({
      sourceNodeIds: ["vc:source:one"],
      mapId: () => "vc:clone:one",
      transform: [1, 0, 0, 0, 1, 0, 80, 40, 1],
      hitTest: "none",
      portals: "omit",
    });
    expect(clone.rootIds).toEqual(["vc:clone:one"]);
    expect(clone.idMap.get("vc:source:one")).toBe("vc:clone:one");
    expect(clone.projection.nodes[0]).toMatchObject({
      id: "vc:clone:one",
      parentId: null,
      transform: {
        position: { x: 90, y: 60 },
      },
    });
    adapter.transients.sync("vc:transient:clone:session", clone.projection);
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
    const resourceOwner = adapter.createResourceRegistrationOwner("element:retained");
    resourceOwner.replace([{
      descriptor: { id: "vc:image:retained", type: "image" },
    }]);
    const portalStage = adapter.portals.stage("element:retained", [{
      portalId: "vc:portal:retained",
      registrationKey: "retained-widget",
      mount: () => () => {
        portalCleanupCount += 1;
      },
    }]);
    await portalStage.prepare();
    await adapter.applyScene({
      snapshot: append(
        adapter.sceneSnapshot(),
        portalNode("vc:element:retained:portal", "vc:portal:retained"),
      ),
      render: "none",
    });
    await portalStage.commit();
    adapter.portals.syncNow("vc:portal:retained");
    await Promise.resolve();
    adapter.transients.sync("vc:transient:retained:session", {
      band: "world-overlay",
      nodes: [rect("vc:transient:retained:node", null)],
    });

    expect(adapter.metricsSnapshot().resourceCount).toBe(1);
    expect(adapter.portals.portalCount).toBe(1);
    expect(adapter.transients.ownerCount).toBe(1);

    await adapter.destroy();

    expect(portalCleanupCount).toBe(1);
    expect(factory.pass.destroyCount).toBe(1);
    expect(host.childElementCount).toBe(0);
    expect(() => resourceOwner.replace([])).toThrow();
  });
});
