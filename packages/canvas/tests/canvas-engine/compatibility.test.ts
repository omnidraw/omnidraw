import {
  IDENTITY_TRANSFORM_2D,
  createInfiniteCanvas,
  type IInfiniteCanvasEngine,
  type TCanvasEngineConfig,
  type TEngineCapabilities,
  type ISceneStore,
  type TLayerNode,
  type TPaint,
  type TRectNode,
  type TSceneNode,
  type TSelectionOverlayState,
} from "@vibecanvas/canvas-engine";
import type {
  IRenderBackendFactory,
  IRenderPassBackend,
  TBackendEffectiveSceneChange,
  TBackendInitContext,
  TBackendRenderResult,
  TBackendResizeContext,
  TRenderFrameContext,
} from "@vibecanvas/canvas-engine/backend";
import {
  composeTransform2D,
  mat3TransformPoint,
} from "@vibecanvas/canvas-engine/geometry";
import {
  ManualClock,
  assertValidSceneSnapshot,
  createRepresentativeSceneFixture,
} from "@vibecanvas/canvas-engine/testing";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
  ensureResizeObserver,
} from "../test-setup";
import { CANVAS_ENGINE_COMPATIBILITY_MATRIX } from "./compatibility.matrix";
import { pocProjectCanvasDocument } from "./poc.project-canvas-doc";

const BLACK: TPaint = {
  type: "solid",
  color: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
};
const WHITE: TPaint = {
  type: "solid",
  color: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
};

class ProbePass implements IRenderPassBackend {
  readonly id = "vibecanvas-compatibility-probe";
  readonly kind = "vector-2d" as const;
  readonly order = 100;
  readonly changes: TBackendEffectiveSceneChange[] = [];
  renderCount = 0;

  initialize(_context: TBackendInitContext): void {}
  capabilities(): Partial<TEngineCapabilities> {
    return {
      supportsGpuPicking: false,
      supportsSvgExport: true,
      unsupportedNodeKinds: [],
    };
  }
  resize(_context: TBackendResizeContext): void {}
  applySceneChanges(change: TBackendEffectiveSceneChange, _scene: ISceneStore): void {
    this.changes.push(change);
  }
  prepareFrame(_context: TRenderFrameContext): void {}
  render(_context: TRenderFrameContext): TBackendRenderResult {
    this.renderCount += 1;
    return {
      drawCalls: 1,
      renderedNodeCount: 1,
      culledNodeCount: 0,
      missingResources: [],
    };
  }
  destroy(): void {}
}

class ProbeFactory implements IRenderBackendFactory {
  readonly id = "webgl2";
  readonly pass = new ProbePass();

  supports(config: TCanvasEngineConfig): boolean {
    return config.renderProfile.vector2D === "webgl2";
  }

  create(_config: TCanvasEngineConfig): IRenderPassBackend[] {
    return [this.pass];
  }
}

function layer(): TLayerNode {
  return {
    id: "content",
    parentId: null,
    orderKey: "A",
    kind: "layer",
    role: "content",
    coordinateSpace: "world",
    transform: IDENTITY_TRANSFORM_2D,
  };
}

function rect(id = "rect", x = 100, orderKey = "A"): TRectNode {
  return {
    id,
    parentId: "content",
    orderKey,
    kind: "rect",
    transform: {
      ...IDENTITY_TRANSFORM_2D,
      position: { x, y: 60 },
    },
    size: { width: 120, height: 80 },
    fill: BLACK,
  };
}

function selection(nodeIds: string[]): TSelectionOverlayState {
  return {
    nodeIds,
    focusedNodeId: nodeIds[0],
    appearance: {
      outline: { paint: BLACK, width: 1 },
      handleFill: WHITE,
      handleStroke: { paint: BLACK, width: 1 },
      handleSize: 8,
      rotateHandleOffset: 20,
    },
    policy: {
      handles: ["move", "rotate", "resize-se"],
      allowRotate: true,
      previewMode: "ephemeral-engine-preview",
    },
  };
}

function sampleDocument(): TCanvasDoc {
  const base = {
    rotation: 90,
    scaleX: 1,
    scaleY: 1,
    bindings: [],
    locked: false,
    parentGroupId: null,
    createdAt: 1,
    updatedAt: 1,
    style: {},
  } as const;
  const crop = {
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    naturalWidth: 64,
    naturalHeight: 64,
  };
  const widgetIdentity = {
    definitionId: "11111111-1111-1111-1111-111111111111",
    revisionId: "22222222-2222-2222-2222-222222222222",
    instanceId: "33333333-3333-3333-3333-333333333333",
  };

  return {
    id: "compatibility-doc",
    name: "Canvas engine compatibility",
    groups: {
      group: {
        id: "group",
        parentGroupId: null,
        zIndex: "A",
        locked: false,
        createdAt: 1,
      },
    },
    elements: {
      rect: {
        ...base,
        id: "rect",
        x: 20,
        y: 30,
        zIndex: "A",
        parentGroupId: "group",
        style: {
          backgroundColor: "#fef3c7",
          strokeColor: "#92400e",
          strokeWidth: "@stroke-width/thin",
        },
        data: {
          type: "rect",
          w: 180,
          h: 100,
          radius: 12,
          text: {
            type: "text",
            w: 180,
            h: 100,
            text: "Inline",
            originalText: "Inline",
            fontFamily: "Arial",
            link: null,
            containerId: null,
            autoResize: false,
          },
        },
      },
      ellipse: {
        ...base,
        id: "ellipse",
        x: 240,
        y: 30,
        rotation: 0,
        zIndex: "B",
        data: { type: "ellipse", rx: 50, ry: 35 },
      },
      diamond: {
        ...base,
        id: "diamond",
        x: 380,
        y: 30,
        rotation: 0,
        zIndex: "C",
        data: { type: "diamond", w: 100, h: 80 },
      },
      line: {
        ...base,
        id: "line",
        x: 20,
        y: 180,
        rotation: 0,
        zIndex: "D",
        style: { strokeColor: "#111827", strokeWidth: "@stroke-width/medium" },
        data: {
          type: "line",
          lineType: "curved",
          points: [[0, 0], [80, 30], [160, 0]],
          startBinding: null,
          endBinding: null,
        },
      },
      arrow: {
        ...base,
        id: "arrow",
        x: 240,
        y: 180,
        rotation: 0,
        zIndex: "E",
        data: {
          type: "arrow",
          lineType: "straight",
          points: [[0, 0], [160, 40]],
          startBinding: null,
          endBinding: null,
          startCap: "dot",
          endCap: "arrow",
        },
      },
      pen: {
        ...base,
        id: "pen",
        x: 20,
        y: 260,
        rotation: 0,
        zIndex: "F",
        style: { backgroundColor: "#2563eb", strokeWidth: "@stroke-width/thick" },
        data: {
          type: "pen",
          points: [[0, 0], [20, 12], [40, 4], [60, 18]],
          pressures: [0.3, 0.6, 0.8, 0.5],
          simulatePressure: false,
        },
      },
      text: {
        ...base,
        id: "text",
        x: 180,
        y: 260,
        rotation: 0,
        zIndex: "G",
        style: { strokeColor: "#111827", fontSize: "@text/m" },
        data: {
          type: "text",
          w: 180,
          h: 40,
          text: "Standalone text",
          originalText: "Standalone text",
          fontFamily: "Arial",
          link: null,
          containerId: null,
          autoResize: false,
        },
      },
      image: {
        ...base,
        id: "image",
        x: 400,
        y: 240,
        rotation: 0,
        zIndex: "H",
        data: {
          type: "image",
          url: "https://example.invalid/fixture.png",
          base64: null,
          w: 120,
          h: 90,
          crop,
        },
      },
      widget: {
        ...base,
        id: "widget",
        x: 560,
        y: 40,
        rotation: 0,
        zIndex: "I",
        data: {
          type: "widget-instance",
          ...widgetIdentity,
          w: 320,
          h: 240,
          expanded: true,
          window: "contained",
        },
      },
    },
  };
}

describe("canvas-engine public compatibility contract", () => {
  let container: HTMLDivElement;
  let engine: IInfiniteCanvasEngine | null;
  let factory: ProbeFactory;

  beforeEach(async () => {
    ensureDom();
    ensureResizeObserver();
    ensureRangeGeometryMocks();
    container = createTestContainer({ width: 800, height: 600 });
    Object.defineProperty(container, "getBoundingClientRect", {
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
    factory = new ProbeFactory();
    engine = await createInfiniteCanvas({
      host: container,
      renderProfile: {
        vector2D: "webgl2",
        threeD: "disabled",
        portals: "dom",
      },
      backendFactories: [factory],
      clock: new ManualClock(),
      initialCamera: {
        center: { x: 0, y: 0 },
        zoom: 1,
        rotation: 0,
      },
      record: { actor: "compatibility-suite" },
    });
  });

  afterEach(async () => {
    await engine?.destroy();
    engine = null;
    container.remove();
  });

  it("loads all documented public entrypoints through the filepath package", () => {
    expect(typeof createInfiniteCanvas).toBe("function");
    expect(typeof composeTransform2D).toBe("function");
    expect(typeof ManualClock).toBe("function");
    expect(factory.pass).toBeInstanceOf(ProbePass);

    const fixture = createRepresentativeSceneFixture();
    expect(() => assertValidSceneSnapshot(fixture)).not.toThrow();
    expect(new Set(fixture.nodes.map((node) => node.kind))).toEqual(new Set([
      "layer",
      "background",
      "group",
      "rect",
      "ellipse",
      "polygon",
      "path",
      "text",
      "image",
      "connector",
      "widget-frame",
      "html-portal",
      "view-3d",
    ]));
  });

  it("provides the lifecycle and capability boundary needed by SceneService", async () => {
    expect(engine!.status).toBe("ready");
    expect(engine!.capabilities.vector2D).toBe("webgl2");
    expect(engine!.capabilities.portals).toBe("dom");

    engine!.resize({ width: 1024, height: 768 });
    expect(engine!.camera.viewportSize).toEqual({ width: 1024, height: 768 });
    engine!.suspend();
    expect(engine!.status).toBe("suspended");
    engine!.resume();
    expect(engine!.status).toBe("ready");
    await engine!.renderNow();
    expect(factory.pass.renderCount).toBeGreaterThan(0);
  });

  it("publishes atomic plain-data scene changes and rolls invalid writes back", () => {
    const changes: number[] = [];
    engine!.scene.subscribe((change) => changes.push(change.revision));
    engine!.scene.transaction((tx) => {
      tx.upsert(layer());
      tx.upsert(rect("back", 20, "A"));
      tx.upsert(rect("front", 40, "B"));
      tx.moveToBack("front");
    }, { source: "compatibility-scene" });

    const beforeRevision = engine!.scene.revision;
    expect(engine!.scene.childrenOf("content").map((node) => node.id)).toEqual([
      "front",
      "back",
    ]);
    expect(() => engine!.scene.transaction((tx) => {
      tx.update("back", (node) => ({
        ...node,
        transform: {
          ...node.transform,
          position: { x: Number.NaN, y: 0 },
        },
      }));
    })).toThrow();
    expect(engine!.scene.revision).toBe(beforeRevision);
    expect(changes).toHaveLength(1);
    expect(() => JSON.stringify(engine!.scene.snapshot())).not.toThrow();
    expect(engine!.recorder?.read()).toHaveLength(1);
  });

  it("replaces Konva transforms, bounds, picking, marquee, and transform preview", () => {
    engine!.scene.replace({
      schemaVersion: "1.0.0",
      rootLayerIds: ["content"],
      nodes: [layer(), rect()],
    });

    const viewport = engine!.camera.worldToViewport({ x: 110, y: 70 });
    expect(engine!.camera.viewportToWorld(viewport)).toEqual({ x: 110, y: 70 });
    expect(engine!.input.hitTestWorld({ x: 110, y: 70 })[0]?.nodeId).toBe("rect");
    expect(engine!.input.queryWorldRect({
      minX: 90,
      minY: 50,
      maxX: 230,
      maxY: 150,
    }).map((hit) => hit.nodeId)).toContain("rect");
    expect(engine!.geometry.worldBounds("rect")).toEqual({
      minX: 100,
      minY: 60,
      maxX: 220,
      maxY: 140,
    });

    engine!.transforms.setSelection(selection(["rect"]));
    const previousTransform = engine!.scene.get("rect")!.transform;
    engine!.transforms.applyPreview([{
      nodeId: "rect",
      previousTransform,
      nextTransform: {
        ...previousTransform,
        position: { x: 150, y: 90 },
      },
      previousSize: { width: 120, height: 80 },
      nextSize: { width: 120, height: 80 },
    }]);
    expect(engine!.geometry.worldBounds("rect")).toEqual({
      minX: 150,
      minY: 90,
      maxX: 270,
      maxY: 170,
    });
    expect(engine!.scene.get("rect")!.transform.position).toEqual({ x: 100, y: 60 });
    engine!.transforms.clearPreview();
    expect(engine!.geometry.worldBounds("rect")?.minX).toBe(100);

    const matrix = composeTransform2D({
      ...IDENTITY_TRANSFORM_2D,
      position: { x: 12, y: 18 },
    });
    expect(mat3TransformPoint(matrix, { x: 2, y: 3 })).toEqual({ x: 14, y: 21 });
  });

  it("routes connectors, exports SVG, and exposes widget-frame hit parts", async () => {
    const widget: TSceneNode = {
      id: "widget",
      parentId: "content",
      orderKey: "B",
      kind: "widget-frame",
      transform: {
        ...IDENTITY_TRANSFORM_2D,
        position: { x: 300, y: 40 },
      },
      size: { width: 260, height: 180 },
      title: "Widget",
      controls: [{ id: "close", kind: "close", label: "Close" }],
      style: {
        background: WHITE,
        titleBarBackground: BLACK,
        titleColor: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
        cornerRadius: 8,
        titleBarHeight: 32,
        padding: { top: 4, right: 4, bottom: 4, left: 4 },
      },
      resizable: true,
    };
    const connector: TSceneNode = {
      id: "connector",
      parentId: "content",
      orderKey: "C",
      kind: "connector",
      transform: IDENTITY_TRANSFORM_2D,
      from: { type: "point", point: { x: 220, y: 100 } },
      to: { type: "node", nodeId: "widget", anchor: "left" },
      routing: { type: "orthogonal", cornerRadius: 6 },
      stroke: { paint: BLACK, width: 2 },
      endMarker: { shape: "arrow", size: 10, filled: true },
    };
    engine!.scene.replace({
      schemaVersion: "1.0.0",
      rootLayerIds: ["content"],
      nodes: [layer(), rect(), widget, connector],
    });

    const route = engine!.geometry.routeConnector(connector);
    expect(route.path.commands.length).toBeGreaterThan(1);
    expect(engine!.input.hitTestWorld({ x: 320, y: 55 })[0]).toMatchObject({
      nodeId: "widget",
      part: "title-bar",
    });
    const exported = await engine!.svg.export({
      nodeIds: ["rect", "widget", "connector"],
      bounds: { minX: 80, minY: 20, maxX: 580, maxY: 240 },
      includeMetadata: true,
    });
    expect(exported.svg).toContain("<svg");
    expect(exported.svg).toContain("{\"id\":\"rect\",\"kind\":\"rect\"}");
  });

  it("mounts application-owned widget DOM through the portal manager", async () => {
    let cleanupCount = 0;
    engine!.portals.register({
      portalId: "portal:widget",
      mount({ host }) {
        host.textContent = "Hosted widget";
        return () => {
          cleanupCount += 1;
        };
      },
    });
    engine!.scene.replace({
      schemaVersion: "1.0.0",
      rootLayerIds: ["content"],
      nodes: [
        layer(),
        {
          id: "portal",
          parentId: "content",
          orderKey: "A",
          kind: "html-portal",
          transform: IDENTITY_TRANSFORM_2D,
          portalId: "portal:widget",
          size: { width: 240, height: 160 },
          interactive: true,
          clipContent: true,
        },
      ],
    });
    engine!.portals.syncNow("portal:widget");
    await Promise.resolve();
    expect(engine!.portals.state("portal:widget")).toMatchObject({
      nodeId: "portal",
      mounted: true,
      visible: true,
    });
    expect(container.textContent).toContain("Hosted widget");

    engine!.scene.transaction((tx) => tx.remove("portal"));
    engine!.portals.syncNow("portal:widget");
    await Promise.resolve();
    expect(engine!.portals.state("portal:widget")?.nodeId).toBeNull();
    expect(cleanupCount).toBe(1);
  });

  it("projects a representative Vibecanvas Automerge document without Konva objects", () => {
    const projected = pocProjectCanvasDocument(sampleDocument());
    expect(() => assertValidSceneSnapshot(projected.snapshot)).not.toThrow();
    expect(projected.resources).toEqual([
      expect.objectContaining({
        descriptor: expect.objectContaining({ id: "image:image", type: "image" }),
      }),
    ]);

    for (const resource of projected.resources) {
      engine!.resources.register(resource.descriptor, resource.source);
    }
    engine!.scene.replace(projected.snapshot, { source: "vibecanvas-poc" });

    const kinds = new Set(engine!.scene.query(() => true).map((node) => node.kind));
    expect(kinds).toEqual(new Set([
      "layer",
      "background",
      "group",
      "rect",
      "text",
      "ellipse",
      "polygon",
      "connector",
      "image",
      "widget-frame",
    ]));
    expect(engine!.scene.get("rect")?.kind).toBe("group");
    expect(engine!.scene.get("rect::inline-text")?.kind).toBe("text");
    expect(engine!.scene.get("widget::render")?.kind).toBe("widget-frame");
    expect(engine!.scene.get("rect")?.transform.rotation).toBeCloseTo(Math.PI / 2);
    expect(engine!.scene.ancestorsOf("rect::inline-text", {
      includeSelf: true,
      order: "node-to-root",
    }).map((node) => node.id)).toEqual([
      "rect::inline-text",
      "rect",
      "group",
      "content",
    ]);
    expect(() => JSON.stringify(engine!.scene.snapshot())).not.toThrow();
  });

  it("keeps every stable Vibecanvas feature in the explicit matrix", () => {
    const ids = CANVAS_ENGINE_COMPATIBILITY_MATRIX.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      "scene-layers",
      "grid",
      "context-menu",
      "history",
      "render-order",
      "semantic-selection",
      "box-transforms",
      "shape1d",
      "shape2d",
      "pen",
      "text",
      "images",
      "groups",
      "automerge-projection",
      "camera",
      "widget-frame",
      "html-portals",
      "runtime-extensions",
    ]));
    expect(CANVAS_ENGINE_COMPATIBILITY_MATRIX
      .filter((row) => row.status === "engine-gap")
      .map((row) => row.id)).toEqual([]);
    expect(Object.fromEntries(
      ["compatible", "adapter", "engine-gap", "release-gap", "validation-gap"]
        .map((status) => [
          status,
          CANVAS_ENGINE_COMPATIBILITY_MATRIX.filter((row) => row.status === status).length,
        ]),
    )).toEqual({
      compatible: 19,
      adapter: 13,
      "engine-gap": 0,
      "release-gap": 1,
      "validation-gap": 3,
    });
  });

  it("supports point handles, clone previews, and external widget ghosts as public transients", () => {
    engine!.scene.replace({
      schemaVersion: "1.0.0",
      rootLayerIds: ["content"],
      nodes: [layer(), rect("source")],
    }, { source: "transient-fixture" });
    const durableBefore = engine!.scene.snapshot();
    const revisionBefore = engine!.scene.revision;
    const journalLengthBefore = engine!.recorder?.read().length;

    const pointHandles = engine!.transients.createOwner("line-point-handles");
    pointHandles.replace({
      band: "screen-overlay",
      hitTest: "enabled",
      nodes: [{
        id: "line:vertex:1",
        parentId: null,
        orderKey: "A",
        kind: "ellipse",
        transform: {
          ...IDENTITY_TRANSFORM_2D,
          position: { x: 20, y: 20 },
        },
        size: { width: 10, height: 10 },
        fill: WHITE,
        stroke: { paint: BLACK, width: 1 },
        pointerEvents: "painted",
      }],
    });

    const clonePreview = engine!.transients.createOwner("alt-drag-clone");
    clonePreview.replace({
      band: "world-overlay",
      hitTest: "none",
      nodes: [{
        ...rect("clone:preview", 260),
        parentId: null,
      }],
    });

    const widgetGhost = engine!.transients.createOwner("sidebar-widget-drop");
    widgetGhost.replace({
      band: "world-overlay",
      hitTest: "none",
      nodes: [{
        id: "widget:ghost",
        parentId: null,
        orderKey: "A",
        kind: "widget-frame",
        transform: {
          ...IDENTITY_TRANSFORM_2D,
          position: { x: 420, y: 80 },
        },
        size: { width: 280, height: 180 },
        title: "Creating widget…",
        style: {
          background: WHITE,
          titleBarBackground: BLACK,
          titleColor: { space: "srgb", r: 1, g: 1, b: 1, a: 1 },
          cornerRadius: 8,
          titleBarHeight: 32,
          padding: { top: 4, right: 4, bottom: 4, left: 4 },
        },
      }],
    });

    expect(engine!.scene.snapshot()).toEqual(durableBefore);
    expect(engine!.scene.revision).toBe(revisionBefore);
    expect(engine!.recorder?.read()).toHaveLength(journalLengthBefore ?? 0);
    expect(engine!.scene.get("clone:preview")).toBeNull();
    expect(engine!.geometry.worldBounds("clone:preview")).toEqual({
      minX: 260,
      minY: 60,
      maxX: 380,
      maxY: 140,
    });
    expect(engine!.input.hitTestViewport({ x: 25, y: 25 })[0]).toMatchObject({
      nodeId: "line:vertex:1",
      transientOwnerId: "line-point-handles",
    });
    expect(engine!.metrics.snapshot()).toMatchObject({
      transientOwnerCount: 3,
      transientNodeCount: 3,
    });

    engine!.scene.transaction((tx) => {
      tx.upsert(rect("clone:preview", 260));
    }, { source: "commit-alt-drag-clone" });
    expect(engine!.scene.get("clone:preview")).not.toBeNull();
    expect(engine!.input.hitTestWorld({ x: 270, y: 70 })[0]).toMatchObject({
      nodeId: "clone:preview",
    });
    expect(engine!.input.hitTestWorld({ x: 270, y: 70 })[0])
      .not.toHaveProperty("transientOwnerId");
    expect(engine!.metrics.snapshot()).toMatchObject({
      transientOwnerCount: 3,
      transientNodeCount: 2,
    });

    clonePreview.clear();
    clonePreview.destroy();
    pointHandles.destroy();
    widgetGhost.destroy();
    expect(engine!.metrics.snapshot()).toMatchObject({
      transientOwnerCount: 0,
      transientNodeCount: 0,
    });
  });
});
