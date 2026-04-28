import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { SyncExitHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import type { CrdtService, SelectionService } from "../../../src/services";
import type { IRuntimeHooks } from "../../../src/types";
import { fnCreateWidgetNode } from "../../../src/services/widget/fn.create-widget-node";
import { fnGetHostThemeColors } from "../../../src/services/widget/fn.get-host-theme-colors";
import { fxAttachWidgetListener } from "../../../src/services/widget/fx.attach-widget-listener";
import { createTestContainer, ensureDom } from "../../test-setup";

const INPUT_HANDLE_ID = "widget-connection-input-handle";
const OUTPUT_HANDLE_ID = "widget-connection-output-handle";
const SCREENSHOT_PATH = resolve("test-artifacts/widget-connection-handles.png");

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
    stage.add(layer);
    layer.add(sourceNode as Konva.Group);
    layer.add(targetNode as Konva.Group);

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

    stage.destroy();
  });
});
