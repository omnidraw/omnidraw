import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ThemeService } from "@vibecanvas/service-theme";
import { AsyncParallelHook, SyncExitHook, SyncHook } from "@vibecanvas/tapable";
import Konva from "konva";
import { describe, expect, test, vi } from "vitest";
import { ELEMENT_DATA_ATTR } from "../../../src/core/CONSTANTS";
import { ContextMenuService } from "../../../src/services/context-menu/ContextMenuService";
import { SelectionService } from "../../../src/services/selection/SelectionService";
import {
  WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX,
  WIDGET_CONNECTION_LINE_ID_PREFIX,
  WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX,
} from "../../../src/services/widget/CONSTANTS";
import { txSyncWidgetConnections } from "../../../src/services/widget/tx.sync-widget-connections";
import type { IRuntimeHooks } from "../../../src/types";
import { createTestContainer, ensureDom } from "../../test-setup";

const CONNECTION_ID = "connection-1";
const LINE_ID = `${WIDGET_CONNECTION_LINE_ID_PREFIX}-${CONNECTION_ID}`;
const INPUT_HANDLE_ID = `${WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX}-${CONNECTION_ID}`;
const OUTPUT_HANDLE_ID = `${WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX}-${CONNECTION_ID}`;

function createRuntimeHooks(): IRuntimeHooks {
  return {
    init: new SyncHook(),
    initAsync: new AsyncParallelHook(),
    destroy: new SyncHook(),
    pointerDown: new SyncHook(),
    pointerUp: new SyncHook(),
    pointerOut: new SyncHook(),
    pointerOver: new SyncHook(),
    pointerMove: new SyncHook(),
    pointerWheel: new SyncHook(),
    pointerCancel: new SyncHook(),
    keydown: new SyncHook(),
    keyup: new SyncHook(),
    gridVisible: new SyncHook(),
    toolSelect: new SyncHook(),
    elementPointerClick: new SyncExitHook(),
    elementPointerDown: new SyncExitHook(),
    elementPointerDoubleClick: new SyncExitHook(),
  } as IRuntimeHooks;
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

async function createConnectedWidgetHarness() {
  ensureDom();
  const { WidgetManagerService } = await import("../../../src/services/widget/WidgetManagerService");
  let registeredDefinition: {
    createNode?: (element: TElement) => Konva.Node | null;
  } | null = null;
  const crdt = createCrdtServiceMock();
  const contextMenu = new ContextMenuService();
  const selection = new SelectionService();
  const container = createTestContainer({ width: 800, height: 600 });
  const stage = new Konva.Stage({ container, width: 800, height: 600 });
  const layer = new Konva.Layer();
  const hooks = createRuntimeHooks();

  stage.add(layer);

  const service = new WidgetManagerService({
    crdtService: crdt as never,
    contextMenuService: contextMenu as never,
    loggingService: {} as never,
    themeService: new ThemeService(),
    selectionService: selection as never,
    elementService: {
      registerElement(definition: { createNode?: (element: TElement) => Konva.Node | null }) {
        registeredDefinition = definition;
      },
    } as never,
    toolService: {} as never,
    sceneService: {
      stage,
      staticForegroundLayer: layer,
    } as never,
    renderOrderService: {} as never,
    cameraService: {
      hooks: { change: { tap: () => () => undefined } },
    } as never,
  });

  service.start({ hooks, config: {} } as never);
  service.registerWidget({ id: "example" });

  const sourceElement = createWidgetElement("source-widget", 10);
  const targetElement = createWidgetElement("target-widget", 260);
  if (sourceElement.data.type !== "widget" || targetElement.data.type !== "widget") {
    throw new Error("expected widget data");
  }
  sourceElement.data.connections = {
    inputs: [],
    outputs: [{ id: CONNECTION_ID, targetWidgetId: "target-widget" }],
  };
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

  const sourceNode = registeredDefinition?.createNode?.(sourceElement);
  const targetNode = registeredDefinition?.createNode?.(targetElement);
  expect(sourceNode).toBeInstanceOf(Konva.Group);
  expect(targetNode).toBeInstanceOf(Konva.Group);

  layer.add(sourceNode as Konva.Group);
  layer.add(targetNode as Konva.Group);
  txSyncWidgetConnections({
    Circle: Konva.Circle,
    Group: Konva.Group,
    Line: Konva.Line,
    selection,
  }, { node: targetNode as Konva.Group });

  return {
    contextMenu,
    crdt,
    hooks,
    layer,
    selection,
    service,
    sourceNode: sourceNode as Konva.Group,
    stage,
    targetNode: targetNode as Konva.Group,
  };
}

function expectConnectionRemovedFromWidgetData(args: { sourceNode: Konva.Group; targetNode: Konva.Group }) {
  const sourceData = args.sourceNode.getAttr(ELEMENT_DATA_ATTR);
  const targetData = args.targetNode.getAttr(ELEMENT_DATA_ATTR);

  expect(sourceData.connections?.outputs ?? []).toEqual([]);
  expect(targetData.connections?.inputs ?? []).toEqual([]);
}

describe("widget connection delete", () => {
  test("backspace removes the selected connection from both widgets' widget data", async () => {
    const harness = await createConnectedWidgetHarness();
    harness.selection.setSelectedConnectionId(CONNECTION_ID);

    harness.hooks.keydown.call(new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    }));

    expectConnectionRemovedFromWidgetData(harness);
    expect(harness.selection.selectedConnectionId).toBeNull();
    expect(harness.layer.findOne(`#${LINE_ID}`)).toBeUndefined();
    expect(harness.sourceNode.findOne(`#${OUTPUT_HANDLE_ID}`)).toBeUndefined();
    expect(harness.targetNode.findOne(`#${INPUT_HANDLE_ID}`)).toBeUndefined();
    expect(harness.crdt.builder.patchElement).toHaveBeenCalledWith("source-widget", "data", expect.objectContaining({
      connections: expect.objectContaining({ outputs: [] }),
    }));
    expect(harness.crdt.builder.patchElement).toHaveBeenCalledWith("target-widget", "data", expect.objectContaining({
      connections: expect.objectContaining({ inputs: [] }),
    }));
    expect(harness.crdt.builder.commit).toHaveBeenCalled();

    harness.service.stop();
    harness.stage.destroy();
  });

  test("delete connection context action removes the connection from both widgets' widget data", async () => {
    const harness = await createConnectedWidgetHarness();
    const actions = harness.contextMenu.getActions({
      scope: "connection",
      connectionId: CONNECTION_ID,
      targetNode: null,
      targetElement: null,
      targetGroup: null,
      selection: [],
      activeSelection: [],
    } as never);
    const deleteConnection = actions.find((action) => action.id === "delete-widget-connection");

    expect(deleteConnection?.label).toBe("Delete connection");
    await deleteConnection?.onSelect();

    expectConnectionRemovedFromWidgetData(harness);
    expect(harness.selection.selectedConnectionId).toBeNull();
    expect(harness.layer.findOne(`#${LINE_ID}`)).toBeUndefined();
    expect(harness.crdt.builder.commit).toHaveBeenCalled();

    harness.service.stop();
    harness.stage.destroy();
  });
});
