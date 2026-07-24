import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  TCanvasDoc,
  TElement,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { getStroke } from "perfect-freehand";
import { afterEach, describe, expect, test } from "vitest";
import { createBuiltInProjectionRegistry } from "../../src/engine/projection/ProjectionRegistry";
import { fxReadCanvasProjectionTheme } from "../../src/engine/projection/fx.theme";
import { fnProjectCanvasDocumentIncremental } from "../../src/engine/projection/fn.incremental-document";
import { fnProjectCanvasDocument } from "../../src/engine/projection/fn.project-document";
import { CrdtService } from "../../src/services/crdt/CrdtService";
import {
  createMockDocHandle,
  createNewCanvasHarness,
  type TNewCanvasHarness,
} from "../new-test-setup";

type TPerfResult = Record<string, unknown> & {
  scenario: string;
  elapsedMs: number;
};

const RESULT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "canvas-runtime.results.local.txt",
);
const BASELINE_SCENE_SIZES = [0, 100, 1_000, 5_000] as const;
const DEFAULT_SCENE_SIZE = 600;
const LARGE_SCENE_SIZE = 2_000;
const CAMERA_UPDATE_COUNT = 120;
const MARQUEE_NODE_COUNT = 2_000;
const CRDT_PATCH_COUNT = 1_000;
const INCREMENTAL_PROJECTION_SAMPLE_COUNT = 40;

let activeHarness: TNewCanvasHarness | null = null;

function appendResult(result: TPerfResult): void {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  appendFileSync(
    RESULT_PATH,
    `${JSON.stringify({
      ...result,
      createdAt: new Date().toISOString(),
    })}\n`,
  );
}

async function timeAsync<TResult>(
  operation: () => Promise<TResult>,
): Promise<{ elapsedMs: number; result: TResult }> {
  const startedAt = performance.now();
  const result = await operation();
  return {
    elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
    result,
  };
}

function time<TResult>(
  operation: () => TResult,
): { elapsedMs: number; result: TResult } {
  const startedAt = performance.now();
  const result = operation();
  return {
    elapsedMs: Number((performance.now() - startedAt).toFixed(3)),
    result,
  };
}

function percentile(
  sorted: readonly number[],
  percentileValue: number,
) {
  return sorted[Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * percentileValue),
  )] ?? 0;
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
  const points = Array.from({ length: 12 }, (_, pointIndex) => {
    return [
      pointIndex * 8,
      Math.sin((pointIndex + index) / 2) * 12,
    ] as [number, number];
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

function createMixedElements(count: number): Record<string, TElement> {
  const elements: Record<string, TElement> = {};
  for (let index = 0; index < count; index += 1) {
    const id = `perf-element-${index}`;
    elements[id] = index % 10 === 0
      ? createPenElement(id, index)
      : index % 5 === 0
        ? createTextElement(id, index)
        : createRectElement(id, index);
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

function projectedNodeCount(harness: TNewCanvasHarness): number {
  const index = harness.scene.projectionIndex;
  if (index === null) {
    return 0;
  }
  return Object.values(index.elementNodeIds)
    .reduce((count, nodeIds) => count + nodeIds.length, 0)
    + Object.keys(index.groupNodeIds).length;
}

afterEach(async () => {
  if (activeHarness !== null) {
    await activeHarness.destroy();
    activeHarness = null;
  }
});

describe("perf: canvas-engine product runtime", () => {
  test.each(BASELINE_SCENE_SIZES)(
    "measures runtime boot, projection, and first render for %i mixed elements",
    async (elementCount) => {
      const docHandle = createMockDocHandle(createPerfDoc(elementCount));
      const measurement = await timeAsync(async () => {
        return createNewCanvasHarness({
          canvasId: `perf-hydration-mixed-${elementCount}`,
          docHandle,
          width: 1800,
          height: 1200,
        });
      });
      activeHarness = measurement.result;
      const metrics = activeHarness.metrics();
      const result: TPerfResult = {
        scenario: "engine-runtime-boot-project-first-render",
        elementCount,
        projectedNodeCount: projectedNodeCount(activeHarness),
        frameCount: metrics.frameCount,
        sceneRevision: metrics.sceneRevision,
        resourceCount: metrics.resourceCount,
        portalCount: metrics.portalCount,
        elapsedMs: measurement.elapsedMs,
      };
      appendResult(result);
      console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

      expect(measurement.elapsedMs).toBeGreaterThan(0);
      expect(Object.keys(activeHarness.scene.projectionIndex?.elementNodeIds
        ?? {})).toHaveLength(elementCount);
      expect(metrics.frameCount).toBeGreaterThan(0);
    },
    120_000,
  );

  test("measures one remote CRDT element through authoritative incremental projection", async () => {
    const doc = createPerfDoc(DEFAULT_SCENE_SIZE);
    const docHandle = createMockDocHandle(doc) as ReturnType<
      typeof createMockDocHandle
    > & {
      __emitChange(): void;
    };
    activeHarness = await createNewCanvasHarness({
      canvasId: "perf-remote-incremental",
      docHandle,
      width: 1800,
      height: 1200,
    });
    const beforeRevision = activeHarness.scene.projectionIndex
      ?.lastAppliedRevision ?? 0;
    doc.elements["perf-remote-added"] = createRectElement(
      "perf-remote-added",
      DEFAULT_SCENE_SIZE + 1,
    );
    const measurement = await timeAsync(async () => {
      docHandle.__emitChange();
      await activeHarness!.flush();
    });
    const result: TPerfResult = {
      scenario: "remote-crdt-incremental-projection",
      elementCountBefore: DEFAULT_SCENE_SIZE,
      elementCountAfter: Object.keys(
        activeHarness.scene.projectionIndex?.elementNodeIds ?? {},
      ).length,
      revisionBefore: beforeRevision,
      revisionAfter: activeHarness.scene.projectionIndex?.lastAppliedRevision,
      elapsedMs: measurement.elapsedMs,
    };
    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(result.elementCountAfter).toBe(DEFAULT_SCENE_SIZE + 1);
    expect(result.revisionAfter).toBe(beforeRevision + 1);
  });

  test("measures isolated one-element product projection at a 5k scene", () => {
    const registry = createBuiltInProjectionRegistry();
    const theme = fxReadCanvasProjectionTheme(new ThemeService(), {});
    let document = createPerfDoc(5_000);
    let projection = fnProjectCanvasDocument({
      document,
      registry,
      theme,
      dependencies: { getStroke },
      revision: 1,
    });
    const samples: number[] = [];
    for (
      let sample = 0;
      sample < INCREMENTAL_PROJECTION_SAMPLE_COUNT;
      sample += 1
    ) {
      const id = `perf-element-${sample * 5 + 1}`;
      const previousElement = document.elements[id]!;
      document = {
        ...document,
        elements: {
          ...document.elements,
          [id]: {
            ...previousElement,
            x: previousElement.x + 1,
            updatedAt: previousElement.updatedAt + 1,
          },
        },
      };
      const measurement = time(() => {
        return fnProjectCanvasDocumentIncremental({
          previous: projection,
          document,
          changes: {
            added: [],
            updated: [id],
            deleted: [],
          },
          registry,
          theme,
          dependencies: { getStroke },
          revision: sample + 2,
        });
      });
      samples.push(measurement.elapsedMs);
      projection = measurement.result.projection;
    }
    samples.sort((left, right) => left - right);
    const p50Ms = percentile(samples, 0.5);
    const p95Ms = percentile(samples, 0.95);
    const p99Ms = percentile(samples, 0.99);
    const result: TPerfResult = {
      scenario: "isolated-one-element-product-projection",
      elementCount: 5_000,
      sampleCount: samples.length,
      p50Ms,
      p95Ms,
      p99Ms,
      elapsedMs: samples.reduce((total, value) => total + value, 0),
    };
    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(samples).toHaveLength(INCREMENTAL_PROJECTION_SAMPLE_COUNT);
    expect(projection.index.lastAppliedRevision).toBe(
      INCREMENTAL_PROJECTION_SAMPLE_COUNT + 1,
    );
  });

  test("measures coalesced camera updates with engine frame metrics", async () => {
    activeHarness = await createNewCanvasHarness({
      canvasId: "perf-camera",
      docHandle: createMockDocHandle(createPerfDoc(DEFAULT_SCENE_SIZE)),
      width: 1800,
      height: 1200,
    });
    const camera = activeHarness.runtime.services.require("camera");
    const before = activeHarness.metrics();
    const measurement = await timeAsync(async () => {
      for (let update = 0; update < CAMERA_UPDATE_COUNT; update += 1) {
        camera.pan(
          update % 2 === 0 ? 8 : -3,
          update % 3 === 0 ? 4 : -2,
        );
        if (update % 12 === 0) {
          camera.zoomAtScreenPoint(1.01, { x: 640, y: 360 });
        }
      }
      await activeHarness!.flush();
    });
    const after = activeHarness.metrics();
    const renderedFrames = after.frameCount - before.frameCount;
    const result: TPerfResult = {
      scenario: "camera-pan-zoom-engine-frame-coalescing",
      elementCount: DEFAULT_SCENE_SIZE,
      cameraUpdateCount: CAMERA_UPDATE_COUNT,
      renderedFrames,
      droppedFrameEstimate:
        after.droppedFrameEstimate - before.droppedFrameEstimate,
      updatesPerRenderedFrame: renderedFrames === 0
        ? null
        : Number((CAMERA_UPDATE_COUNT / renderedFrames).toFixed(3)),
      elapsedMs: measurement.elapsedMs,
    };
    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(measurement.elapsedMs).toBeGreaterThan(0);
    expect(renderedFrames).toBeGreaterThan(0);
    expect(renderedFrames).toBeLessThan(CAMERA_UPDATE_COUNT);
  });

  test("measures semantic marquee rectangle query over projected nodes", async () => {
    activeHarness = await createNewCanvasHarness({
      canvasId: "perf-marquee",
      docHandle: createMockDocHandle(createPerfDoc(MARQUEE_NODE_COUNT)),
      width: 2400,
      height: 1600,
    });
    const measurement = time(() => {
      return activeHarness!.scene.input.queryWorldRect({
        rect: {
          minX: 0,
          minY: 0,
          maxX: 1800,
          maxY: 1200,
        },
        options: {
          mode: "all",
        },
      });
    });
    const result: TPerfResult = {
      scenario: "semantic-marquee-engine-spatial-query",
      elementCount: MARQUEE_NODE_COUNT,
      selectedCount: measurement.result.length,
      elapsedMs: measurement.elapsedMs,
    };
    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    expect(measurement.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(measurement.result.length).toBeGreaterThan(0);
  });

  test("measures CRDT builder batch patch cost", () => {
    const docHandle = createMockDocHandle(createPerfDoc(LARGE_SCENE_SIZE));
    const crdt = new CrdtService({ docHandle });
    crdt.start();
    const measurement = time(() => {
      const builder = crdt.build();
      for (let index = 0; index < CRDT_PATCH_COUNT; index += 1) {
        const id = `perf-element-${index}`;
        const element = crdt.doc().elements[id];
        if (element === undefined) {
          continue;
        }
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
      elapsedMs: measurement.elapsedMs,
    };
    appendResult(result);
    console.info(`[canvas-runtime-perf] ${JSON.stringify(result)}`);

    crdt.stop();
    expect(measurement.elapsedMs).toBeGreaterThan(0);
  });
});
