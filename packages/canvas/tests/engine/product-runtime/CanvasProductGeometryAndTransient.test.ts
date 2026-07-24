import type {
  ICamera2DController,
  IGeometryService,
} from "@vibecanvas/canvas-engine";
import { describe, expect, it, vi } from "vitest";
import { CanvasTransientTargetRegistry } from "../../../src/engine/input/CanvasTransientTargetRegistry";
import { CanvasProductGeometryService } from "../../../src/engine/product-runtime/CanvasProductGeometryService";
import { CanvasProductTransientService } from "../../../src/engine/product-runtime/CanvasProductTransientService";
import type { TCanvasProductRuntimeEnginePorts } from "../../../src/engine/product-runtime/interface";
import type { TCanvasProjectionIndex } from "../../../src/engine/typed";

function projectionIndex(): TCanvasProjectionIndex {
  return {
    elementNodeIds: {
      first: ["node:first", "node:first:render"],
      second: ["node:second"],
    },
    groupNodeIds: {
      group: "group:root",
    },
    nodeTargets: {
      "node:first": { kind: "element", id: "first" },
      "node:first:render": { kind: "element", id: "first" },
      "node:second": { kind: "element", id: "second" },
      "group:root": { kind: "group", id: "group" },
    },
    elementResourceIds: {},
    elementPortalIds: {},
    elementSignatures: {},
    groupSignatures: {},
    activeProjectionSignature: "projection",
    lastAppliedRevision: 1,
  };
}

describe("CanvasProductGeometryService", () => {
  it("resolves semantic targets for bounds, queries, and coordinate conversions", () => {
    const geometry = {
      worldBounds: vi.fn(() => ({
        minX: 10,
        minY: 20,
        maxX: 110,
        maxY: 80,
      })),
      unionBounds: vi.fn(() => ({
        minX: 0,
        minY: 0,
        maxX: 200,
        maxY: 100,
      })),
      localToWorld: vi.fn((_id, point) => ({
        x: point.x + 10,
        y: point.y + 20,
      })),
      worldToLocal: vi.fn((_id, point) => ({
        x: point.x - 10,
        y: point.y - 20,
      })),
      intersectsRect: vi.fn(() => true),
      intersectsPolygon: vi.fn(() => true),
      nearestPoint: vi.fn(() => ({
        point: { x: 10, y: 20 },
        distance: 4,
      })),
    } as unknown as IGeometryService;
    const camera = {
      clientToViewport: vi.fn((point) => ({ x: point.x - 5, y: point.y - 5 })),
      viewportToClient: vi.fn((point) => ({ x: point.x + 5, y: point.y + 5 })),
      viewportToWorld: vi.fn((point) => ({ x: point.x / 2, y: point.y / 2 })),
      worldToViewport: vi.fn((point) => ({ x: point.x * 2, y: point.y * 2 })),
      worldToClient: vi.fn((point) => ({
        x: point.x * 2 + 5,
        y: point.y * 2 + 5,
      })),
      visibleWorldBounds: vi.fn(() => ({
        minX: -100,
        minY: -50,
        maxX: 100,
        maxY: 50,
      })),
    } as unknown as ICamera2DController;
    const service = new CanvasProductGeometryService({
      geometry,
      camera,
      getProjectionIndex: projectionIndex,
    });
    const first = { target: { kind: "element" as const, id: "first" } };

    expect(service.worldBounds(first)).toEqual({
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 80,
    });
    expect(geometry.worldBounds).toHaveBeenCalledWith("node:first", undefined);
    expect(service.unionBounds([
      first,
      { target: { kind: "element", id: "second" } },
    ])).toEqual({
      minX: 0,
      minY: 0,
      maxX: 200,
      maxY: 100,
    });
    expect(geometry.unionBounds).toHaveBeenCalledWith([
      "node:first",
      "node:second",
    ]);
    expect(service.localToWorld(first, { x: 2, y: 3 })).toEqual({
      x: 12,
      y: 23,
    });
    expect(service.worldToLocal(first, { x: 12, y: 23 })).toEqual({
      x: 2,
      y: 3,
    });
    expect(service.intersectsRect(first, {
      minX: 0,
      minY: 0,
      maxX: 20,
      maxY: 20,
    })).toBe(true);
    expect(service.nearestPoint(first, { x: 14, y: 20 })).toEqual({
      point: { x: 10, y: 20 },
      distance: 4,
    });
    expect(service.clientToViewport({ x: 25, y: 35 })).toEqual({
      x: 20,
      y: 30,
    });
    expect(service.viewportToWorld({ x: 20, y: 30 })).toEqual({
      x: 10,
      y: 15,
    });
    expect(service.worldToClient({ x: 10, y: 15 })).toEqual({
      x: 25,
      y: 35,
    });
    expect(service.visibleWorldBounds()).toEqual({
      minX: -100,
      minY: -50,
      maxX: 100,
      maxY: 50,
    });
    expect(service.worldBounds({
      target: { kind: "element", id: "missing" },
    })).toBeNull();
  });
});

describe("CanvasProductTransientService", () => {
  it("prefixes neutral nodes, registers semantic ownership, and cleans both owners", () => {
    const replace = vi.fn();
    const clear = vi.fn();
    const destroy = vi.fn();
    const engineTransients = {
      createOwner: vi.fn(() => ({
        id: "selection",
        replace,
        clear,
        destroy,
      })),
    };
    const transientTargets = new CanvasTransientTargetRegistry();
    const service = new CanvasProductTransientService({
      transients: engineTransients,
      transientTargets,
    } as unknown as TCanvasProductRuntimeEnginePorts);
    const owner = service.createOwner({
      ownerId: "selection",
      target: { kind: "element", id: "first" },
    });
    owner.replace({
      band: "screen-overlay",
      hitTest: "enabled",
      nodes: [
        {
          id: "root",
          parentId: null,
          orderKey: "A",
          kind: "group",
        },
        {
          id: "handle",
          parentId: "root",
          orderKey: "A",
          kind: "ellipse",
          size: { width: 8, height: 8 },
          fill: { r: 0, g: 0.5, b: 1, a: 1 },
        },
        {
          id: "widget",
          parentId: null,
          orderKey: "B",
          kind: "widget-frame",
          size: { width: 320, height: 240 },
          title: "Adding Weather…",
          style: {
            background: { r: 1, g: 1, b: 1, a: 0.2 },
            border: {
              color: { r: 0, g: 0.4, b: 1, a: 1 },
              width: 2,
              dash: [8, 5],
            },
            titleBarBackground: { r: 0, g: 0.4, b: 1, a: 0.12 },
            titleColor: { r: 0, g: 0.25, b: 0.8, a: 1 },
            cornerRadius: 10,
            titleBarHeight: 34,
            padding: { top: 8, right: 8, bottom: 8, left: 8 },
          },
        },
      ],
    });

    expect(replace).toHaveBeenCalledWith({
      band: "screen-overlay",
      hitTest: "enabled",
      nodes: [
        expect.objectContaining({
          id: "selection::root",
          parentId: null,
          kind: "group",
        }),
        expect.objectContaining({
          id: "selection::handle",
          parentId: "selection::root",
          kind: "ellipse",
        }),
        expect.objectContaining({
          id: "selection::widget",
          kind: "widget-frame",
          title: "Adding Weather…",
        }),
      ],
    });
    expect(replace.mock.calls[0]?.[0].nodes[2]).not.toHaveProperty("portal");
    expect(transientTargets.resolve({
      ownerId: "selection",
      nodeId: "selection::handle",
      handleId: "handle",
      path: ["selection::root", "selection::handle"],
    })).toEqual({ kind: "element", id: "first" });
    owner.clear();
    expect(clear).toHaveBeenCalledTimes(1);
    owner.destroy();
    owner.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(transientTargets.resolve({
      ownerId: "selection",
      nodeId: "selection::handle",
      handleId: "handle",
      path: [],
    })).toBeNull();
    service.destroy();
    service.destroy();
  });
});
