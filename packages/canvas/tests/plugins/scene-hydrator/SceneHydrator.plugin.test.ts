import type { DocHandle } from "@automerge/automerge-repo";
import type { TCanvasDoc, TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Konva from "konva";
import { describe, expect, test } from "vitest";
import { createMockDocHandle, createNewCanvasHarness, flushCanvasEffects } from "../../new-test-setup";

function createTextElement(overrides?: Partial<TElement>): TElement {
  return {
    id: "text-1",
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: "a0",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 2,
    data: {
      type: "text",
      w: 120,
      h: 30,
      text: "hello",
      originalText: "hello",
      fontFamily: "Arial",
      link: null,
      containerId: null,
      autoResize: false,
    },
    style: {
      opacity: 0.8,
    },
    ...overrides,
  };
}

function createWidgetElement(overrides?: Partial<TElement>): TElement {
  return {
    id: "widget-1",
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: "a0",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 2,
    data: {
      type: "widget",
      kind: "published-widget",
      w: 260,
      h: 160,
      expanded: true,
      window: "contained",
      actorDefinitionName: "Published Widget",
      actorInstanceId: "actor-instance-1",
    },
    style: {
      opacity: 1,
    },
    ...overrides,
  };
}

describe("new SceneHydrator plugin", () => {
  test("applies remote element updates without recreating the scene node", async () => {
    const element = createTextElement({ id: "text-live" });
    if (element.data.type === "text") {
      element.data.text = "before";
      element.data.originalText = "before";
    }
    const docHandle = createMockDocHandle({
      elements: {
        [element.id]: element,
      },
    }) as DocHandle<TCanvasDoc> & { __emitChange: () => void };

    const harness = await createNewCanvasHarness({ docHandle });
    const node = harness.staticForegroundLayer.findOne<Konva.Text>("#text-live");
    if (!node) {
      throw new Error("missing text node");
    }

    docHandle.change((doc) => {
      const nextElement = doc.elements[element.id];
      if (nextElement?.data.type === "text") {
        nextElement.data.text = "after";
        nextElement.data.originalText = "after";
      }
    });
    docHandle.__emitChange();
    await flushCanvasEffects();

    const updatedNode = harness.staticForegroundLayer.findOne<Konva.Text>("#text-live");
    expect(updatedNode).toBe(node);
    expect(updatedNode?.text()).toBe("after");

    await harness.destroy();
  });

  test("rehydrates scene on doc change and keeps selection on surviving nodes", async () => {
    const selectedElement = createTextElement({ id: "text-selected" });
    const remoteElement = createTextElement({ id: "text-live", x: 200 });
    const docHandle = createMockDocHandle({
      elements: {
        [selectedElement.id]: selectedElement,
      },
    }) as DocHandle<TCanvasDoc> & { __emitChange: () => void };

    const harness = await createNewCanvasHarness({ docHandle });
    const selection = harness.runtime.services.require("selection");

    const selectedNode = harness.staticForegroundLayer.findOne<Konva.Text>("#text-selected");
    if (!selectedNode) {
      throw new Error("missing selected node");
    }

    selection.setSelection([selectedNode]);
    selection.setFocusedNode(selectedNode);

    expect(harness.staticForegroundLayer.findOne<Konva.Text>("#text-live")).toBeFalsy();

    docHandle.change((doc) => {
      doc.elements[remoteElement.id] = remoteElement;
    });
    docHandle.__emitChange();
    await flushCanvasEffects();

    const hydratedSelectedNode = harness.staticForegroundLayer.findOne<Konva.Text>("#text-selected");
    const hydratedRemoteNode = harness.staticForegroundLayer.findOne<Konva.Text>("#text-live");

    expect(hydratedSelectedNode).toBeTruthy();
    expect(hydratedRemoteNode).toBeTruthy();
    expect(hydratedSelectedNode).toBe(selectedNode);
    expect(selection.selection[0]).toBe(hydratedSelectedNode);
    expect(selection.focusedId).toBe("text-selected");

    await harness.destroy();
  });

  test("cleans up old widget DOM portal before reloading a published widget kind", async () => {
    const widgetElement = createWidgetElement();
    const docHandle = createMockDocHandle({
      elements: {
        [widgetElement.id]: widgetElement,
      },
    }) as DocHandle<TCanvasDoc>;

    const harness = await createNewCanvasHarness({ docHandle });
    const widgetManager = harness.runtime.services.require("widgetManager");
    let cleanupCount = 0;

    widgetManager.registerWidget({
      id: "published-widget",
      dataType: "widget",
      tool: {
        label: "Published Widget",
      },
      actor: {
        actorDefinitionName: "Published Widget",
      },
      renderDom: ({ root }) => {
        const content = root.ownerDocument.createElement("div");
        content.textContent = "published widget";
        root.appendChild(content);
        return () => {
          cleanupCount += 1;
          content.remove();
        };
      },
    });
    harness.runtime.hooks.widgetRegister.call({ kind: "published-widget" });
    await flushCanvasEffects();

    const widgetPortal = harness.stage.container().querySelector("#widget-portal");
    expect(widgetPortal?.querySelectorAll("[data-widget-element-id='widget-1']")).toHaveLength(1);

    harness.runtime.hooks.widgetRegister.call({ kind: "published-widget" });
    await flushCanvasEffects();

    expect(cleanupCount).toBe(1);
    expect(widgetPortal?.querySelectorAll("[data-widget-element-id='widget-1']")).toHaveLength(1);

    await harness.destroy();
  });
});
