import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncExitHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import type { CrdtService, SelectionService } from "../../../src/services";
import type { IRuntimeHooks } from "../../../src/types";
import {
  WIDGET_CONNECTION_BOUNDARY_ID,
  WIDGET_CONNECTION_HANDLE_ID,
  WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX,
  WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX,
} from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { fxAttachWidgetListener } from "../../../src/services/widget/fx.attach-widget-listener";
import { txUpdateWidgetNodeFromElement } from "../../../src/services/widget/tx.update-widget-node-from-element";
import { createStagePointerEvent, createTestContainer, ensureDom } from "../../test-setup";

const INPUT_HANDLE_ID = `${WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX}-connection-1`;
const OUTPUT_HANDLE_ID = `${WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX}-connection-1`;
const SCREENSHOT_PATH = resolve("tests/artifacts/widget-connection-handles.png");

function writeStageScreenshot(stage: Konva.Stage) {
  const dataUrl = stage.toDataURL({ pixelRatio: 1 });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  mkdirSync(dirname(SCREENSHOT_PATH), { recursive: true });
  writeFileSync(SCREENSHOT_PATH, Buffer.from(base64, "base64"));
}

function createHooks() {
  return {
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  } as unknown as IRuntimeHooks;
}

function toLayerPoint(layer: Konva.Layer | Konva.FastLayer, point: { x: number; y: number }) {
  return layer.getAbsoluteTransform().copy().invert().point(point);
}

function createCrdtServiceMock() {
  type TBuilder = {
    patchElement: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };
  const builder = {} as TBuilder;
  builder.patchElement = vi.fn(() => builder);
  builder.commit = vi.fn(() => ({}));

  return {
    build: vi.fn(() => builder),
    builder,
  };
}

function createWidgetElement(id: string, x: number): TElement {
  return {
    id,
    x,
    y: 20,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: "widget",
      kind: "example",
      w: 160,
      h: 120,
      expanded: true,
      window: "contained",
      payload: {},
    },
  };
}

describe("widget connection handles", () => {
  test("keeps the drag preview blue and commits the drag-start widget as the input", () => {
    ensureDom();

    const inputElement = createWidgetElement("input-widget", 10);
    const outputElement = createWidgetElement("output-widget", 260);
    const container = createTestContainer({ width: 800, height: 600 });
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const colors = fnGetHostThemeColors(new ThemeService());
    const inputNode = fnCreateWidgetNode(Konva, colors, inputElement);
    const outputNode = fnCreateWidgetNode(Konva, colors, outputElement);
    const crdt = createCrdtServiceMock();
    const syncConnections = vi.fn();

    expect(inputNode).toBeInstanceOf(Konva.Group);
    expect(outputNode).toBeInstanceOf(Konva.Group);

    stage.add(layer);
    layer.add(inputNode as Konva.Group);
    layer.add(outputNode as Konva.Group);

    fxAttachWidgetListener({
      node: inputNode as Konva.Group,
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      Rect: Konva.Rect,
      hooks: createHooks(),
      selection: { mode: "select", selection: [], focusedId: null } as unknown as SelectionService,
      toElement: (node) => node.id() === inputElement.id ? inputElement : outputElement,
      crdtService: crdt as unknown as CrdtService,
      createConnectionId: () => "connection-1",
      syncConnections,
    }, {});

    const boundary = (inputNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`);
    expect(boundary).toBeInstanceOf(Konva.Line);

    const downEvent = createStagePointerEvent(stage, {
      x: inputElement.x + 80,
      y: inputElement.y - 10,
      type: "pointerdown",
    });
    boundary?.fire("pointerdown", {
      target: boundary,
      currentTarget: boundary,
      evt: downEvent,
      cancelBubble: false,
    });

    const tempLine = layer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Line
        && candidate.dash().length > 0
        && candidate.id() !== WIDGET_CONNECTION_BOUNDARY_ID;
    });

    expect(tempLine).toBeInstanceOf(Konva.Line);
    expect((tempLine as Konva.Line).stroke()).toBe("#38bdf8");
    expect(((inputNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_HANDLE_ID}`) as Konva.Circle).fill()).toBe("#38bdf8");

    vi.spyOn(stage, "getIntersection").mockReturnValue(outputNode as Konva.Group);
    const upEvent = createStagePointerEvent(stage, {
      x: outputElement.x + 80,
      y: outputElement.y + 60,
      type: "pointerup",
    });
    stage.fire("pointerup", {
      target: stage,
      currentTarget: stage,
      evt: upEvent,
      cancelBubble: false,
    });

    const nextInputData = (inputNode as Konva.Group).getAttr(ELEMENT_DATA_ATTR);
    const nextOutputData = (outputNode as Konva.Group).getAttr(ELEMENT_DATA_ATTR);

    expect(nextInputData.connections?.inputs).toEqual([
      expect.objectContaining({
        id: "connection-1",
        sourceWidgetId: "output-widget",
      }),
    ]);
    expect(nextOutputData.connections?.outputs).toEqual([
      expect.objectContaining({
        id: "connection-1",
        targetWidgetId: "input-widget",
      }),
    ]);
    expect(crdt.builder.patchElement).toHaveBeenCalledWith("output-widget", "data", expect.objectContaining({
      connections: expect.objectContaining({
        outputs: [expect.objectContaining({ targetWidgetId: "input-widget" })],
      }),
    }));
    expect(crdt.builder.patchElement).toHaveBeenCalledWith("input-widget", "data", expect.objectContaining({
      connections: expect.objectContaining({
        inputs: [expect.objectContaining({ sourceWidgetId: "output-widget" })],
      }),
    }));

    stage.destroy();
  });

  test("updates the in-progress connection line and renders hovered output handle gray", () => {
    ensureDom();

    const inputElement = createWidgetElement("input-widget", 10);
    const outputElement = createWidgetElement("output-widget", 260);
    const container = createTestContainer({ width: 800, height: 600 });
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const colors = fnGetHostThemeColors(new ThemeService());
    const inputNode = fnCreateWidgetNode(Konva, colors, inputElement);
    const outputNode = fnCreateWidgetNode(Konva, colors, outputElement);
    const crdt = createCrdtServiceMock();

    expect(inputNode).toBeInstanceOf(Konva.Group);
    expect(outputNode).toBeInstanceOf(Konva.Group);

    stage.add(layer);
    layer.add(inputNode as Konva.Group);
    layer.add(outputNode as Konva.Group);

    const attachNode = (node: Konva.Group) => fxAttachWidgetListener({
      node,
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      Rect: Konva.Rect,
      hooks: createHooks(),
      selection: { mode: "select", selection: [], focusedId: null } as unknown as SelectionService,
      toElement: (candidate) => candidate.id() === inputElement.id ? inputElement : outputElement,
      crdtService: crdt as unknown as CrdtService,
      createConnectionId: () => "connection-1",
      syncConnections: vi.fn(),
    }, {});
    attachNode(inputNode as Konva.Group);
    attachNode(outputNode as Konva.Group);

    const inputBoundary = (inputNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`);
    const outputBoundary = (outputNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`);
    expect(inputBoundary).toBeInstanceOf(Konva.Line);
    expect(outputBoundary).toBeInstanceOf(Konva.Line);

    const downEvent = createStagePointerEvent(stage, {
      x: inputElement.x + 80,
      y: inputElement.y - 10,
      type: "pointerdown",
    });
    inputBoundary?.fire("pointerdown", {
      target: inputBoundary,
      currentTarget: inputBoundary,
      evt: downEvent,
      cancelBubble: false,
    });

    const tempLine = layer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Line
        && candidate.dash().length > 0
        && candidate.id() !== WIDGET_CONNECTION_BOUNDARY_ID;
    }) as Konva.Line | undefined;
    expect(tempLine).toBeInstanceOf(Konva.Line);

    const hoverPoint = { x: outputElement.x + 160, y: outputElement.y + 60 };
    const hoverEvent = createStagePointerEvent(stage, {
      ...hoverPoint,
      type: "pointermove",
    });
    outputBoundary?.fire("pointerover", {
      target: outputBoundary,
      currentTarget: outputBoundary,
      evt: hoverEvent,
      cancelBubble: false,
    });

    const expectedPointerPoint = toLayerPoint(layer, hoverPoint);
    const points = tempLine.points();
    expect(points.slice(2)).toEqual([expectedPointerPoint.x, expectedPointerPoint.y]);
    expect(((outputNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_HANDLE_ID}`) as Konva.Circle).fill()).toBe("#94a3b8");
    expect(((outputNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_HANDLE_ID}`) as Konva.Circle).visible()).toBe(true);

    stage.destroy();
  });

  test("renders blue input and gray output handles for established connections", () => {
    ensureDom();

    const sourceElement = createWidgetElement("source-widget", 10);
    const targetElement = createWidgetElement("target-widget", 260);
    if (targetElement.data.type !== "widget") throw new Error("expected widget data");
    targetElement.data.connections = {
      inputs: [{
        id: "connection-1",
        sourceWidgetId: "source-widget",
        line: {
          sourceArc: 0,
          targetArc: 0.5,
          waypoints: [],
        },
      }],
      outputs: [],
    };

    const container = createTestContainer({ width: 800, height: 600 });
    const stage = new Konva.Stage({ container, width: 800, height: 600 });
    const layer = new Konva.Layer();
    const colors = fnGetHostThemeColors(new ThemeService());
    const sourceNode = fnCreateWidgetNode(Konva, colors, sourceElement);
    const targetNode = fnCreateWidgetNode(Konva, colors, targetElement);

    expect(sourceNode).toBeInstanceOf(Konva.Group);
    expect(targetNode).toBeInstanceOf(Konva.Group);
    fxAttachWidgetListener({
      node: sourceNode as Konva.Group,
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      Rect: Konva.Rect,
      hooks: createHooks(),
      selection: { mode: "select", selection: [], focusedId: null } as unknown as SelectionService,
      toElement: (node) => node.id() === sourceElement.id ? sourceElement : targetElement,
      crdtService: {} as CrdtService,
    }, {});

    stage.add(layer);
    layer.add(sourceNode as Konva.Group);
    layer.add(targetNode as Konva.Group);
    txUpdateWidgetNodeFromElement({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      Rect: Konva.Rect,
    }, {
      node: targetNode as Konva.Group,
      element: targetElement,
    });

    layer.draw();
    writeStageScreenshot(stage);

    const outputHandle = (sourceNode as Konva.Group).findOne(`#${OUTPUT_HANDLE_ID}`);
    const inputHandle = (targetNode as Konva.Group).findOne(`#${INPUT_HANDLE_ID}`);

    expect(outputHandle).toBeInstanceOf(Konva.Circle);
    expect(inputHandle).toBeInstanceOf(Konva.Circle);
    expect((outputHandle as Konva.Circle).visible()).toBe(true);
    expect((inputHandle as Konva.Circle).visible()).toBe(true);
    expect((outputHandle as Konva.Circle).fill()).toBe("#94a3b8");
    expect((inputHandle as Konva.Circle).fill()).toBe("#38bdf8");
    expect((outputHandle as Konva.Circle).zIndex()).toBeGreaterThan(
      ((sourceNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`) as Konva.Line).zIndex(),
    );
    expect((inputHandle as Konva.Circle).zIndex()).toBeGreaterThan(
      ((targetNode as Konva.Group).findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`) as Konva.Line).zIndex(),
    );

    stage.destroy();
  });
});
