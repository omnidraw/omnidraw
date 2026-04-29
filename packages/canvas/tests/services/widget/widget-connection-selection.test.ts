import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import { CanvasMode } from "../../../src/services/selection/CONSTANTS";
import {
  WIDGET_CONNECTION_LINE_ID_PREFIX,
} from "../../../src/services/widget/CONSTANTS";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { txSyncWidgetConnections } from "../../../src/services/widget/tx.sync-widget-connections";
import { createTestContainer, ensureDom } from "../../test-setup";

const CONNECTION_ID = "connection-1";
const LINE_ID = `${WIDGET_CONNECTION_LINE_ID_PREFIX}-${CONNECTION_ID}`;

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

function createConnectedWidgetScene() {
  ensureDom();

  const sourceElement = createWidgetElement("source-widget", 10);
  const targetElement = createWidgetElement("target-widget", 260);
  if (targetElement.data.type !== "widget") throw new Error("expected widget data");
  targetElement.data.connections = {
    inputs: [{
      id: CONNECTION_ID,
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

  stage.add(layer);
  layer.add(sourceNode as Konva.Group);
  layer.add(targetNode as Konva.Group);

  return {
    stage,
    layer,
    sourceNode: sourceNode as Konva.Group,
    targetNode: targetNode as Konva.Group,
  };
}

describe("widget connection selection", () => {
  test("keeps connection selection separate from element selection", () => {
    const selection = new SelectionService();
    const node = new Konva.Rect({ id: "selected-element" });

    selection.setSelection([node]);
    selection.setFocusedNode(node);
    selection.setSelectedConnectionId(CONNECTION_ID);

    expect(selection.selectedConnectionId).toBe(CONNECTION_ID);
    expect(selection.selection).toEqual([]);
    expect(selection.focusedId).toBeNull();

    selection.setSelection([node]);
    expect(selection.selectedConnectionId).toBeNull();

    selection.setSelectedConnectionId(CONNECTION_ID);
    selection.clear();
    expect(selection.selectedConnectionId).toBeNull();
  });

  test("selects a rendered connection line without selecting a transformable node", () => {
    const scene = createConnectedWidgetScene();
    const selection = new SelectionService();

    txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      selection,
    }, { node: scene.targetNode });

    const line = scene.layer.findOne(`#${LINE_ID}`);
    expect(line).toBeInstanceOf(Konva.Line);
    expect((line as Konva.Line).listening()).toBe(true);
    expect((line as Konva.Line).draggable()).toBe(false);
    expect((line as Konva.Line).hitStrokeWidth()).toBeGreaterThanOrEqual(32);
    expect((line as Konva.Line).hitStrokeWidth()).toBeGreaterThan((line as Konva.Line).strokeWidth());

    line?.fire("pointerdown", {
      target: line,
      currentTarget: line,
      evt: new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      cancelBubble: false,
    });

    expect(selection.selectedConnectionId).toBe(CONNECTION_ID);
    expect(selection.selection).toEqual([]);

    txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      selection,
    }, { node: scene.targetNode });

    expect((line as Konva.Line).stroke()).toBe("#38bdf8");
    expect((line as Konva.Line).strokeWidth()).toBeGreaterThan(2);
    (line as Konva.Line).draggable(true);
    (line as Konva.Line).position({ x: 12, y: 8 });
    (line as Konva.Line).fire("dragmove", {
      target: line,
      currentTarget: line,
      evt: new MouseEvent("pointermove", { bubbles: true }),
      cancelBubble: false,
    });
    expect((line as Konva.Line).draggable()).toBe(false);
    expect((line as Konva.Line).position()).toEqual({ x: 0, y: 0 });

    scene.stage.destroy();
  });

  test("expands connection line hit area as the canvas zooms out", () => {
    const scene = createConnectedWidgetScene();
    const selection = new SelectionService();

    txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      selection,
    }, { node: scene.targetNode });
    const line = scene.layer.findOne(`#${LINE_ID}`) as Konva.Line | undefined;
    expect(line).toBeInstanceOf(Konva.Line);
    const hitStrokeWidthAtDefaultZoom = line?.hitStrokeWidth() ?? 0;

    scene.layer.scale({ x: 0.5, y: 0.5 });
    txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      selection,
    }, { node: scene.targetNode });

    expect(line?.hitStrokeWidth()).toBeGreaterThan(hitStrokeWidthAtDefaultZoom);

    scene.stage.destroy();
  });

  test("does not select connection lines outside select mode", () => {
    const scene = createConnectedWidgetScene();
    const selection = new SelectionService();
    selection.setMode(CanvasMode.HAND);

    txSyncWidgetConnections({
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      selection,
    }, { node: scene.targetNode });

    const line = scene.layer.findOne(`#${LINE_ID}`);
    expect(line).toBeInstanceOf(Konva.Line);
    line?.fire("pointerdown", {
      target: line,
      currentTarget: line,
      evt: new MouseEvent("pointerdown", { button: 0, bubbles: true }),
      cancelBubble: false,
    });

    expect(selection.selectedConnectionId).toBeNull();

    scene.stage.destroy();
  });
});
