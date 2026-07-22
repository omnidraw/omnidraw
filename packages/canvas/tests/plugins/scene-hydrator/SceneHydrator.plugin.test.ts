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

describe("new SceneHydrator plugin", () => {
  test.each(["filesystem", "terminal"])("preserves unmatched persisted %s ui widgets without mounting them", async (kind) => {
    const element = createTextElement({
      id: `${kind}-legacy-widget`,
      data: {
        type: "ui-widget",
        kind,
        w: 600,
        h: 400,
        expanded: false,
        window: "contained",
        payload: { legacy: true },
      },
    });
    const docHandle = createMockDocHandle({ elements: { [element.id]: element } });
    const harness = await createNewCanvasHarness({ docHandle });

    expect(harness.staticForegroundLayer.findOne(`#${element.id}`)).toBeFalsy();
    expect(docHandle.doc().elements[element.id]).toEqual(element);

    await harness.destroy();
  });

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

  test("rehydrates non-widget elements by id after a late definition is registered", async () => {
    const affectedElement = createTextElement({ id: "late-definition" });
    const unaffectedElement = createTextElement({ id: "unchanged-definition", x: 200 });
    const docHandle = createMockDocHandle({
      elements: {
        [affectedElement.id]: affectedElement,
        [unaffectedElement.id]: unaffectedElement,
      },
    });
    const harness = await createNewCanvasHarness({ docHandle });
    const elementService = harness.runtime.services.require("element");
    const originalAffectedNode = harness.staticForegroundLayer.findOne("#late-definition");
    const originalUnaffectedNode = harness.staticForegroundLayer.findOne("#unchanged-definition");

    elementService.registerElement({
      id: "late-text-definition",
      priority: 0,
      matchesElement: (element) => element.id === affectedElement.id,
      createNode: (element) => new Konva.Rect({
        id: element.id,
        x: element.x,
        y: element.y,
        width: 40,
        height: 20,
      }),
    });
    harness.runtime.hooks.elementDefinitionInvalidated.call({ elementIds: [affectedElement.id] });

    const rehydratedNode = harness.staticForegroundLayer.findOne("#late-definition");
    expect(rehydratedNode).toBeInstanceOf(Konva.Rect);
    expect(rehydratedNode).not.toBe(originalAffectedNode);
    expect(harness.staticForegroundLayer.findOne("#unchanged-definition")).toBe(originalUnaffectedNode);

    await harness.destroy();
  });

});
