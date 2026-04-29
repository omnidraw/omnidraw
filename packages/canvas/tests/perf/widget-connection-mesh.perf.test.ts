import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { fnCreateWidgetNode } from "../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../src/services/widget/fn.get-host-theme-colors";
import { txSyncWidgetConnections } from "../../src/services/widget/tx.sync-widget-connections";
import { createTestContainer, ensureDom } from "../test-setup";

type TPerfCounters = {
  batchDrawCalls: number;
  layerFindCalls: number;
  layerFindOneCalls: number;
  linePointWrites: number;
  lineMoveToBottomCalls: number;
  syncCalls: number;
};

type TPerfResult = TPerfCounters & {
  scenario: string;
  widgetCount: number;
  connectionCount: number;
  dragFrameCount: number;
  elapsedMs: number;
  workScore: number;
};

const WIDGET_COUNT = 80;
const CONNECTION_DEGREE = 6;
const DRAG_FRAME_COUNT = 60;
const RESULT_PATH = join(dirname(fileURLToPath(import.meta.url)), "widget-connection-mesh.results.local.txt");

function createWidgetElement(id: string, index: number): TElement {
  const columns = 10;
  const x = 40 + (index % columns) * 170;
  const y = 40 + Math.floor(index / columns) * 140;

  return {
    id,
    x,
    y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: String(index).padStart(6, "0"),
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: "widget",
      kind: "perf-widget",
      w: 140,
      h: 96,
      expanded: true,
      window: "contained",
      payload: {},
      connections: {
        inputs: [],
        outputs: [],
      },
    },
  };
}

function connectWidgets(elements: TElement[]) {
  let connectionCount = 0;

  elements.forEach((target, targetIndex) => {
    if (target.data.type !== "widget") return;

    for (let offset = 1; offset <= CONNECTION_DEGREE; offset += 1) {
      const sourceIndex = targetIndex - offset;
      if (sourceIndex < 0) continue;

      const source = elements[sourceIndex];
      if (!source || source.data.type !== "widget") continue;

      const id = `connection-${sourceIndex}-${targetIndex}`;
      const sourceArc = offset % 2 === 0 ? 0 : 0.125;
      const targetArc = offset % 2 === 0 ? 0.5 : 0.625;

      source.data.connections = {
        inputs: source.data.connections?.inputs ?? [],
        outputs: [
          ...(source.data.connections?.outputs ?? []),
          { id, targetWidgetId: target.id },
        ],
      };
      target.data.connections = {
        inputs: [
          ...(target.data.connections?.inputs ?? []),
          {
            id,
            sourceWidgetId: source.id,
            line: {
              sourceArc,
              targetArc,
              waypoints: [],
            },
          },
        ],
        outputs: target.data.connections?.outputs ?? [],
      };
      connectionCount += 1;
    }
  });

  return connectionCount;
}

function createWidgetMesh() {
  ensureDom();

  const container = createTestContainer({ width: 1800, height: 1200 });
  const stage = new Konva.Stage({ container, width: 1800, height: 1200 });
  const layer = new Konva.Layer();
  const colors = fnGetHostThemeColors(new ThemeService());
  const elements = Array.from({ length: WIDGET_COUNT }, (_, index) => createWidgetElement(`widget-${index}`, index));
  const connectionCount = connectWidgets(elements);
  const nodes = elements.map((element) => {
    const node = fnCreateWidgetNode(Konva, colors, element);
    if (!(node instanceof Konva.Group)) {
      throw new Error(`failed to create widget node ${element.id}`);
    }
    return node;
  });

  stage.add(layer);
  nodes.forEach((node) => layer.add(node));

  return { stage, layer, nodes, connectionCount };
}

function createCounters(): TPerfCounters {
  return {
    batchDrawCalls: 0,
    layerFindCalls: 0,
    layerFindOneCalls: 0,
    linePointWrites: 0,
    lineMoveToBottomCalls: 0,
    syncCalls: 0,
  };
}

function instrumentLayer(layer: Konva.Layer, counters: TPerfCounters) {
  const originalBatchDraw = layer.batchDraw.bind(layer);
  const originalFind = layer.find.bind(layer);
  const originalFindOne = layer.findOne.bind(layer);

  layer.batchDraw = ((...args: unknown[]) => {
    counters.batchDrawCalls += 1;
    return originalBatchDraw(...args as []);
  }) as typeof layer.batchDraw;

  layer.find = ((...args: unknown[]) => {
    counters.layerFindCalls += 1;
    return originalFind(...args as [never]);
  }) as typeof layer.find;

  layer.findOne = ((...args: unknown[]) => {
    counters.layerFindOneCalls += 1;
    return originalFindOne(...args as [never]);
  }) as typeof layer.findOne;
}

function instrumentConnectionLines(layer: Konva.Layer, counters: TPerfCounters) {
  const lines = layer.find((node: Konva.Node) => {
    return node instanceof Konva.Line && node.id().startsWith("widget-connection-line-");
  }) as Konva.Line[];

  lines.forEach((line) => {
    const originalPoints = line.points.bind(line);
    const originalMoveToBottom = line.moveToBottom.bind(line);

    line.points = ((points?: number[]) => {
      if (points !== undefined) {
        counters.linePointWrites += 1;
      }
      return points === undefined ? originalPoints() : originalPoints(points);
    }) as typeof line.points;

    line.moveToBottom = (() => {
      counters.lineMoveToBottomCalls += 1;
      return originalMoveToBottom();
    }) as typeof line.moveToBottom;
  });

  return lines.length;
}

function calculateWorkScore(result: TPerfCounters) {
  return result.linePointWrites
    + result.lineMoveToBottomCalls
    + result.layerFindOneCalls * 10
    + result.batchDrawCalls * 100
    + result.layerFindCalls * 1000;
}

function appendResult(result: TPerfResult) {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  appendFileSync(RESULT_PATH, `${JSON.stringify({ ...result, createdAt: new Date().toISOString() })}\n`);
}

describe("perf: widget connection mesh", () => {
  test("measures work done while dragging one widget in a dense connection mesh", () => {
    const { stage, layer, nodes, connectionCount } = createWidgetMesh();

    txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
    }, { node: nodes[0] });

    const counters = createCounters();
    instrumentLayer(layer, counters);
    const renderedLineCount = instrumentConnectionLines(layer, counters);
    expect(renderedLineCount).toBe(connectionCount);

    const draggedNode = nodes[Math.floor(nodes.length / 2)];
    const startedAt = performance.now();

    for (let frame = 0; frame < DRAG_FRAME_COUNT; frame += 1) {
      draggedNode.position({
        x: draggedNode.x() + 2,
        y: draggedNode.y() + (frame % 2 === 0 ? 1 : -1),
      });
      counters.syncCalls += 1;
      txSyncWidgetConnections({
        Circle: Konva.Circle,
        Group: Konva.Group,
        Line: Konva.Line,
      }, { node: draggedNode });
    }

    const elapsedMs = performance.now() - startedAt;
    const result: TPerfResult = {
      scenario: "current-widget-connection-full-sync-per-drag-frame",
      widgetCount: WIDGET_COUNT,
      connectionCount,
      dragFrameCount: DRAG_FRAME_COUNT,
      elapsedMs: Number(elapsedMs.toFixed(3)),
      ...counters,
      workScore: calculateWorkScore(counters),
    };

    appendResult(result);
    console.info(`[widget-connection-mesh-perf] ${JSON.stringify(result)}`);

    expect(result.workScore).toBeGreaterThan(0);
    expect(result.linePointWrites).toBe(connectionCount * DRAG_FRAME_COUNT);

    stage.destroy();
  });
});
