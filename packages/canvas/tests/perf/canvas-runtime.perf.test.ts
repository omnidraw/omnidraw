import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TCanvasDoc, TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { afterEach, describe, expect, test } from "vitest";
import { txHandleStagePointerMove } from "../../src/plugins/select/tx.handle-stage-pointer-move";
import { CrdtService } from "../../src/services/crdt/CrdtService";
import { SelectionService } from "../../src/services/selection/SelectionService";
import { createMockDocHandle, createNewCanvasHarness, type TNewCanvasHarness } from "../new-test-setup";
import { createTestContainer, ensureDom } from "../test-setup";

type TPerfCounters = {
  batchDrawCalls: number;
  stageBatchDrawCalls: number;
  foregroundBatchDrawCalls: number;
  backgroundBatchDrawCalls: number;
  dynamicBatchDrawCalls: number;
};

type TPerfResult = Record<string, unknown> & {
  scenario: string;
  elapsedMs: number;
};

const RESULT_PATH = join(dirname(fileURLToPath(import.meta.url)), "canvas-runtime.results.local.txt");
const DEFAULT_SCENE_SIZE = 600;
const LARGE_SCENE_SIZE = 2_000;
const CAMERA_FRAME_COUNT = 120;
const MARQUEE_NODE_COUNT = 2_000;
const CRDT_PATCH_COUNT = 1_000;

let activeHarness: TNewCanvasHarness | null = null;

function appendResult(result: TPerfResult) {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  appendFileSync(RESULT_PATH, `${JSON.stringify({ ...result, createdAt: new Date().toISOString() })}\n`);
}

function timeMs(callback: () => void) {
  const startedAt = performance.now();
  callback();
  return Number((performance.now() - startedAt).toFixed(3));
}

function createRectElement(id: string, index: number): TElement {
  const columns = 40;
  return {
    id,
    x: 20 + (index % columns) * 80,
    y: 20 + Math.floor(index / columns) * 60,
    rotation: index % 7 === 0 ? 8 : 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: String(index).padStart(8, "0"),
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {
      backgroundColor: index % 2 === 0 ? "@base/50" : "@base/100",
      strokeColor: "@base/900",
      strokeWidth: "sm",
      opacity: 1,
    },
    data: {
      type: "rect",
      w: 56 + (index % 4) * 8,
      h: 36 + (index % 3) * 8,
    },
  };
}

function createTextElement(id: string, index: number): TElement {
  return {
    ...createRectElement(id, index),
    style: {
      strokeColor: "@base/900",
      fontSize: "md",
    },
    data: {
      type: "text",
      w: 140,
      h: 40,
      text: `Text ${index}`,
      originalText: `Text ${index}`,
      fontFamily: "Inter",
      link: null,
      containerId: null,
      autoResize: true,
    },
  };
}

function createPenElement(id: string, index: number): TElement {
  const pointCount = 12;
  const points = Array.from({ length: pointCount }, (_, pointIndex) => {
    return [pointIndex * 8, Math.sin((pointIndex + index) / 2) * 12] as [number, number];
  });

  return {
    ...createRectElement(id, index),
    style: {
      backgroundColor: "@base/900",
      strokeWidth: "md",
      opacity: 1,
    },
    data: {
      type: "pen",
      points,
      pressures: points.map(() => 0.5),
      simulatePressure: true,
    },
  };
}

function createMixedElements(count: number) {
  const elements: Record<string, TElement> = {};

  for (let index = 0; index < count; index += 1) {
    const id = `perf-element-${index}`;
    const element = index % 10 === 0
      ? createPenElement(id, index)
      : index % 5 === 0
        ? createTextElement(id, index)
        : createRectElement(id, index);
    elements[id] = element;
  }

  return elements;
}

function createPerfDoc(count: number): TCanvasDoc {
  return {
    id: `perf-doc-${count}`,
    name: `perf-doc-${count}`,
    elements: createMixedElements(count),
    groups: {},
  };
}

function createCounters(): TPerfCounters {
  return {
    batchDrawCalls: 0,
    stageBatchDrawCalls: 0,
    foregroundBatchDrawCalls: 0,
    backgroundBatchDrawCalls: 0,
    dynamicBatchDrawCalls: 0,
  };
}

function instrumentBatchDraw(target: Konva.Stage | Konva.Layer, onCall: () => void) {
  const original = target.batchDraw.bind(target);
  target.batchDraw = ((...args: unknown[]) => {
    onCall();
    return original(...args as []);
  }) as typeof target.batchDraw;
}

function instrumentCanvasDraws(harness: TNewCanvasHarness) {
  const counters = createCounters();
  instrumentBatchDraw(harness.stage, () => {
    counters.batchDrawCalls += 1;
    counters.stageBatchDrawCalls += 1;
  });
  instrumentBatchDraw(harness.staticBackgroundLayer, () => {
    counters.batchDrawCalls += 1;
    counters.backgroundBatchDrawCalls += 1;
  });
  instrumentBatchDraw(harness.staticForegroundLayer, () => {
    counters.batchDrawCalls += 1;
    counters.foregroundBatchDrawCalls += 1;
  });
  instrumentBatchDraw(harness.dynamicLayer, () => {
    counters.batchDrawCalls += 1;
    counters.dynamicBatchDrawCalls += 1;
  });
  return counters;
}

function countSceneNodes(layer: Konva.Layer) {
  return layer.find((node: Konva.Node) => node !== layer).length;
}

function hasSameSelectionOrder(
  currentSelection: Array<{ id(): string }>,
  nextSelection: Array<{ id(): string }>,
) {
  if (currentSelection.length !== nextSelection.length) return false;
  return currentSelection.every((node, index) => node.id() === nextSelection[index]?.id());
}

afterEach(async () => {
  if (activeHarness) {
    await activeHarness.destroy();
    activeHarness = null;
  }
});

describe("perf: canvas runtime", () => {
  test("measures runtime boot and full scene hydration for a mixed document", async () => {
    const docHandle = createMockDocHandle(createPerfDoc(DEFAULT_SCENE_SIZE));
    const startedAt = performance.now();
    activeHarness = await createNewCanvasHarness({
      canvasId: "perf-hydration-mixed",
      docHandle,
      width: 1800,
      height: 1200,
    });
    const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
    const result: TPerfResult = {
      scenario: "runtime-boot-hydrate-mixed-document",
      elementCount: DEFAULT_SCENE_SIZE,
      foregroundNodeCount: countSceneNodes(activeHarness.staticForegroundLayer),
      elapsedMs,
    };

    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(elapsedMs).toBeGreaterThan(0);
    expect(result.foregroundNodeCount).toBeGreaterThan(0);
  });

  test("measures non-local CRDT change incremental apply cost", async () => {
    const doc = createPerfDoc(DEFAULT_SCENE_SIZE);
    const docHandle = createMockDocHandle(doc) as ReturnType<typeof createMockDocHandle> & { __emitChange(): void };
    activeHarness = await createNewCanvasHarness({
      canvasId: "perf-remote-reload",
      docHandle,
      width: 1800,
      height: 1200,
    });

    doc.elements["perf-remote-added"] = createRectElement("perf-remote-added", DEFAULT_SCENE_SIZE + 1);
    const elapsedMs = timeMs(() => {
      docHandle.__emitChange();
    });
    const result: TPerfResult = {
      scenario: "non-local-crdt-change-incremental-apply",
      elementCountBefore: DEFAULT_SCENE_SIZE,
      elementCountAfter: DEFAULT_SCENE_SIZE + 1,
      foregroundNodeCount: countSceneNodes(activeHarness.staticForegroundLayer),
      elapsedMs,
    };

    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(elapsedMs).toBeGreaterThan(0);
    expect(result.foregroundNodeCount).toBeGreaterThan(0);
  });

  test("measures camera pan and zoom draw scheduling", async () => {
    const docHandle = createMockDocHandle(createPerfDoc(DEFAULT_SCENE_SIZE));
    activeHarness = await createNewCanvasHarness({
      canvasId: "perf-camera",
      docHandle,
      width: 1800,
      height: 1200,
    });
    const camera = activeHarness.runtime.services.require("camera");
    const counters = instrumentCanvasDraws(activeHarness);
    const elapsedMs = timeMs(() => {
      for (let frame = 0; frame < CAMERA_FRAME_COUNT; frame += 1) {
        camera.pan(frame % 2 === 0 ? 8 : -3, frame % 3 === 0 ? 4 : -2);
        if (frame % 12 === 0) {
          camera.zoomAtScreenPoint(camera.zoom * 1.01, { x: 640, y: 360 });
        }
      }
    });
    const result: TPerfResult = {
      scenario: "camera-pan-zoom-draw-scheduling",
      elementCount: DEFAULT_SCENE_SIZE,
      frameCount: CAMERA_FRAME_COUNT,
      elapsedMs,
      ...counters,
      batchDrawsPerFrame: Number((counters.batchDrawCalls / CAMERA_FRAME_COUNT).toFixed(3)),
    };

    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(elapsedMs).toBeGreaterThan(0);
    expect(counters.foregroundBatchDrawCalls).toBeGreaterThan(0);
    expect(counters.dynamicBatchDrawCalls).toBeGreaterThan(0);
  });

  test("measures marquee selection scan over many top-level nodes", () => {
    ensureDom();
    const container = createTestContainer({ width: 2400, height: 1600 });
    const stage = new Konva.Stage({ container, width: 2400, height: 1600 });
    const layer = new Konva.Layer();
    const dynamicLayer = new Konva.Layer();
    stage.add(layer);
    stage.add(dynamicLayer);

    for (let index = 0; index < MARQUEE_NODE_COUNT; index += 1) {
      layer.add(new Konva.Rect({
        id: `marquee-node-${index}`,
        x: 10 + (index % 80) * 28,
        y: 10 + Math.floor(index / 80) * 28,
        width: 18,
        height: 18,
        fill: "#e2e8f0",
        stroke: "#0f172a",
        listening: true,
      }));
    }

    const selection = new SelectionService();
    const selectionRectangle = new Konva.Rect({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      visible: true,
      listening: false,
    });
    dynamicLayer.add(selectionRectangle);

    const scene = {
      staticForegroundLayer: layer,
    } as unknown as Parameters<typeof txHandleStagePointerMove>[0]["scene"];

    const elapsedMs = timeMs(() => {
      txHandleStagePointerMove({
        Group: Konva.Group,
        Shape: Konva.Shape,
        Util: Konva.Util,
        scene,
        selection,
        selectionRectangle,
        hasSameSelectionOrder,
      }, { pointer: { x: 1800, y: 1200 } });
    });
    const result: TPerfResult = {
      scenario: "marquee-selection-top-level-scan",
      nodeCount: MARQUEE_NODE_COUNT,
      selectedCount: selection.selection.length,
      elapsedMs,
    };

    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(elapsedMs).toBeGreaterThan(0);
    expect(selection.selection.length).toBeGreaterThan(0);
    stage.destroy();
    container.remove();
  });

  test("measures CRDT builder batch patch cost", () => {
    const docHandle = createMockDocHandle(createPerfDoc(LARGE_SCENE_SIZE));
    const crdt = new CrdtService({ docHandle });
    crdt.start();

    const elapsedMs = timeMs(() => {
      const builder = crdt.build();
      for (let index = 0; index < CRDT_PATCH_COUNT; index += 1) {
        const id = `perf-element-${index}`;
        const element = crdt.doc().elements[id];
        if (!element) continue;
        builder.patchElement(id, "x", element.x + 10);
        builder.patchElement(id, "y", element.y + 5);
        builder.patchElement(id, "updatedAt", element.updatedAt + 1);
      }
      builder.commit();
    });
    const result: TPerfResult = {
      scenario: "crdt-builder-batch-position-patch",
      documentElementCount: LARGE_SCENE_SIZE,
      patchedElementCount: CRDT_PATCH_COUNT,
      patchedFieldCount: CRDT_PATCH_COUNT * 3,
      elapsedMs,
    };

    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    crdt.stop();
    expect(elapsedMs).toBeGreaterThan(0);
  });
});
