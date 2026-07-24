import {
  createInfiniteCanvas,
  type TCanvasEngineConfig,
} from "@vibecanvas/canvas-engine";
import { ManualClock } from "@vibecanvas/canvas-engine/testing";
import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncHook } from "@vibecanvas/tapable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TCanvasProjectionCoordinatorResult } from "../../../src/engine/ProjectionCoordinator";
import { ElementService } from "../../../src/services/element/ElementService";
import { SceneService } from "../../../src/services/scene/SceneService";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import type { TCrdtChangeSummary } from "../../../src/services/crdt/CrdtService";
import {
  createTestContainer,
  ensureDom,
  ensureRangeGeometryMocks,
} from "../../test-setup";
import { CanvasEngineTestFactory } from "../../engine/engine-test-backend";
import { createCanvasDoc, createElement } from "../crdt/helpers";

function addedSummary(revision: number, elementId: string): TCrdtChangeSummary {
  const element = createElement(elementId, {
    data: {
      type: "rect",
      w: 120,
      h: 80,
    },
  });
  return {
    revision,
    origin: "remote",
    fullReload: false,
    elements: {
      added: [elementId],
      updated: [],
      deleted: [],
      changes: {
        [elementId]: {
          kind: "added",
          before: null,
          after: element,
          changedFields: Object.keys(element).sort(),
        },
      },
    },
    groups: {
      added: [],
      updated: [],
      deleted: [],
      changes: {},
    },
  };
}

async function drainClock(
  clock: ManualClock,
  operation: Promise<unknown>,
): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
    if (clock.pendingFrameCount > 0) {
      clock.advance(16);
    }
  }
  await operation;
}

describe("SceneService", () => {
  beforeEach(() => {
    ensureDom();
    ensureRangeGeometryMocks();
  });

  it("hydrates, renders, incrementally projects, reprojects view/theme, and tears down", async () => {
    const container = createTestContainer({
      width: 800,
      height: 600,
    }) as HTMLDivElement;
    const factory = new CanvasEngineTestFactory();
    const clock = new ManualClock();
    const engineConfigs: TCanvasEngineConfig[] = [];
    const change = new SyncHook<[TCrdtChangeSummary]>();
    let document: TCanvasDoc = createCanvasDoc();
    let revision = 0;
    const crdt = {
      doc: () => document,
      get revision() {
        return revision;
      },
      hooks: {
        change,
        write: new SyncHook(),
      },
    };
    const theme = new ThemeService();
    const selection = new SelectionService({ now: () => 0 });
    const element = new ElementService();
    const releasePortal = vi.fn();
    const portal = {
      mount: vi.fn(async () => releasePortal),
    };
    let resizeListener: ResizeObserverCallback | null = null;
    const disconnect = vi.fn();
    const scene = new SceneService({
      container,
      crdt: crdt as never,
      theme,
      selection,
      element,
      portal: portal as never,
      createEngine: async (config) => {
        engineConfigs.push(config);
        return createInfiniteCanvas(config);
      },
      engineConfig: {
        backendFactories: [factory],
        clock,
      },
      createResizeObserver: (listener) => {
        resizeListener = listener;
        return {
          observe: vi.fn(),
          disconnect,
        };
      },
    });
    const resizeEvents: Array<[number, number]> = [];
    const projectionEvents: TCanvasProjectionCoordinatorResult[] = [];
    scene.hooks.resize.tap((width, height) => {
      resizeEvents.push([width, height]);
    });
    scene.hooks.projection.tap((result) => {
      projectionEvents.push(result);
    });

    const start = scene.start();
    expect(scene.start()).toBe(start);
    await drainClock(clock, start);

    expect(scene.state).toBe("ready");
    expect(scene.projectionIndex?.lastAppliedRevision).toBe(0);
    expect(scene.camera.started).toBe(true);
    expect(scene.product.geometry.visibleWorldBounds()).toEqual({
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 600,
    });
    expect(factory.pass.renderCount).toBeGreaterThan(0);
    expect(engineConfigs).toHaveLength(1);
    expect(resizeEvents).toEqual([[800, 600]]);
    expect(resizeListener).not.toBeNull();
    expect(projectionEvents[0]).toMatchObject({
      status: "applied",
      revision: 0,
      origin: "initial",
    });

    const cancelForRemoteChange = vi.spyOn(
      scene.product,
      "cancelForRemoteChange",
    );
    const rect = createElement("rect", {
      data: {
        type: "rect",
        w: 120,
        h: 80,
      },
    });
    document = createCanvasDoc({
      elements: { rect },
    });
    revision = 1;
    change.call(addedSummary(revision, "rect"));

    await vi.waitFor(() => {
      expect(scene.projectionIndex?.lastAppliedRevision).toBe(1);
    });
    expect(cancelForRemoteChange).not.toHaveBeenCalled();
    expect(scene.projectionIndex?.elementNodeIds.rect).toBeDefined();

    await expect(scene.setGridVisible(false)).resolves.toBe(true);
    expect(projectionEvents.at(-1)).toMatchObject({
      status: expect.stringMatching(/applied|noop/),
      revision: 1,
      origin: "view",
    });

    theme.setTheme("dark");
    await vi.waitFor(() => {
      expect(projectionEvents.some((event) => event.origin === "theme"))
        .toBe(true);
    });

    const stop = scene.stop();
    expect(scene.stop()).toBe(stop);
    await stop;
    expect(scene.state).toBe("stopped");
    expect(disconnect).toHaveBeenCalledOnce();
    expect(clock.pendingFrameCount).toBe(0);
    expect(container.childElementCount).toBe(0);
    container.remove();
  });
});
