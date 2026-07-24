import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { getStroke } from "perfect-freehand";
import { describe, expect, test, vi } from "vitest";
import type { TCanvasProjectionDefinition } from "../../src/engine/projection/typed";
import type { TCanvasProjectionTheme } from "../../src/engine/typed";
import { ElementService } from "../../src/services/element/ElementService";

const THEME: TCanvasProjectionTheme = {
  id: "element-service-test",
  colors: {
    accent: "#dbeafe",
    accentForeground: "#1e3a8a",
    border: "#d6d3d1",
    canvasBackground: "#ffffff",
    canvasGridMajor: "#cccccc",
    canvasGridMinor: "#eeeeee",
    canvasSelectionStroke: "#3b82f6",
    canvasText: "#000000",
    card: "#ffffff",
    destructive: "#dc2626",
    muted: "#e7e5e4",
    mutedForeground: "#57534e",
    ring: "#f59e0b",
    success: "#16a34a",
    warning: "#d97706",
  },
  colorTokens: {},
};

function createElement(
  id = "element-1",
  type: "text" | "rect" = "text",
): TElement {
  return {
    id,
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: "z00000000",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 2,
    data: type === "rect"
      ? {
          type: "rect",
          w: 100,
          h: 40,
        }
      : {
          type: "text",
          w: 100,
          h: 40,
          text: "hello",
          originalText: "hello",
          fontFamily: "Arial",
          link: null,
          containerId: null,
          autoResize: false,
        },
    style: {},
  };
}

function projection(id: string, priority: number): TCanvasProjectionDefinition {
  return {
    id,
    priority,
    matchesElement: () => true,
    project: () => ({ nodes: [] }),
  };
}

function createWidgetElement(): TElement {
  return {
    ...createElement("widget", "rect"),
    data: {
      type: "ui-widget",
      kind: "dashboard",
      w: 320,
      h: 200,
      expanded: true,
      window: "contained",
      payload: {},
    },
  };
}

describe("ElementService", () => {
  test("registers product definitions deterministically and unregisters once", () => {
    const service = new ElementService();
    const changes = vi.fn();
    service.hooks.elementsChange.tap(changes);
    const removeHigh = service.registerElement({
      id: "high",
      priority: 20,
      matchesElement: () => true,
    });
    service.registerElement({
      id: "low",
      priority: 10,
      matchesElement: () => true,
    });

    expect(service.getDefinitions().map((definition) => definition.id))
      .toEqual(["low", "high"]);
    expect(changes).toHaveBeenCalledTimes(2);
    removeHigh();
    removeHigh();
    expect(service.getDefinitions().map((definition) => definition.id))
      .toEqual(["low"]);
    expect(changes).toHaveBeenCalledTimes(3);
    service.invalidateProjection();
    expect(changes).toHaveBeenCalledTimes(4);
  });

  test("matches persisted product elements and merges style policy by priority", () => {
    const service = new ElementService();
    const text = createElement();
    service.registerElement({
      id: "base",
      priority: 10,
      matchesElement: (element) => element.data.type === "text",
      getSelectionStyleMenu: () => ({
        sections: {
          showFillPicker: true,
          showTextPickers: true,
        },
        values: {
          fillColor: "#ffffff",
          fontFamily: "Arial",
        },
      }),
    });
    service.registerElement({
      id: "modifier",
      priority: 20,
      matchesElement: (element) => element.id === text.id,
      getSelectionStyleMenu: () => ({
        sections: { showFillPicker: false },
        values: { fillColor: "#000000" },
      }),
    });

    expect(service.getMatchingElementDefinitionsByElement(text)
      .map((definition) => definition.id)).toEqual(["base", "modifier"]);
    expect(service.getSelectionStyleMenuConfigByElement({
      element: text,
    })).toMatchObject({
      sections: {
        showFillPicker: false,
        showTextPickers: true,
      },
      values: {
        fillColor: "#000000",
        fontFamily: "Arial",
      },
    });
    expect(service.getSelectionStyleMenuConfigByElement({
      element: createElement("rect", "rect"),
    })).toBeNull();
  });

  test("merges transform policy over renderer-neutral defaults", () => {
    const service = new ElementService();
    const text = createElement();
    service.registerElement({
      id: "text-base",
      priority: 10,
      matchesElement: (element) => element.data.type === "text",
      getTransformPolicy: () => ({
        handles: ["move", "resize-e", "resize-w"],
        keepAspectRatio: true,
        minSize: { width: 40, height: 20 },
      }),
    });
    service.registerElement({
      id: "text-modifier",
      priority: 20,
      matchesElement: (element) => element.data.type === "text",
      getTransformPolicy: () => ({
        keepAspectRatio: false,
        allowRotate: false,
      }),
    });

    expect(service.getTransformPolicy({
      element: text,
      selection: [text],
    })).toEqual({
      handles: ["move", "resize-e", "resize-w"],
      keepAspectRatio: false,
      allowFlip: false,
      allowRotate: false,
      minSize: { width: 40, height: 20 },
    });
  });

  test("publishes only declared renderer-neutral projection extensions", () => {
    const service = new ElementService();
    service.registerElement({
      id: "without-projection",
      matchesElement: () => true,
    });
    service.registerElement({
      id: "projector-low",
      matchesElement: () => true,
      projection: projection("projector-low", 10),
    });
    service.registerElement({
      id: "projector-high",
      matchesElement: () => true,
      projection: projection("projector-high", 20),
    });

    expect(service.projectionExtensions().definitions.map((definition) => {
      return definition.id;
    })).toEqual(["projector-high", "projector-low"]);
  });

  test("adapts renderer-neutral widget chrome into the engine projection", () => {
    const service = new ElementService();
    const widget = createWidgetElement();
    service.registerElement({
      id: "widget-host",
      priority: 20,
      matchesElement: (element) => element.data.type === "ui-widget",
      getWidgetChrome: () => ({
        title: "Live dashboard",
        active: true,
        actions: [{
          id: "settings",
          label: "Settings",
          kind: "menu",
          disabled: true,
        }],
      }),
    });

    const projector = service.projectionExtensions().definitions.find(
      (definition) => definition.id === "widget-chrome:widget-host",
    );
    expect(projector).toBeDefined();
    const projected = projector!.project({
      element: widget,
      parentNodeId: "vc:layer:world",
      theme: THEME,
      dependencies: { getStroke },
    });
    expect(projected.nodes.find((node) => node.kind === "widget-frame"))
      .toMatchObject({
        title: "Live dashboard",
        active: true,
        controls: expect.arrayContaining([
          expect.objectContaining({
            id: "settings",
            kind: "menu",
            label: "Settings",
            disabled: true,
          }),
        ]),
      });
  });

  test("composes clone-data policies without allowing extensions to replace product IDs", () => {
    const service = new ElementService();
    const source = createElement("widget", "rect");
    const clone = { ...source, id: "clone-widget" };
    service.registerElement({
      id: "clone-base",
      matchesElement: () => true,
      prepareCloneData: ({ clone: current }) => ({
        ...current.data,
        w: 240,
      }),
    });
    service.registerElement({
      id: "clone-modifier",
      matchesElement: () => true,
      prepareCloneData: ({ clone: current }) => ({
        ...current.data,
        h: 120,
      }),
    });

    expect(service.prepareClone({
      source,
      clone,
      createId: () => "extension-id",
    })).toMatchObject({
      id: "clone-widget",
      data: { type: "rect", w: 240, h: 120 },
    });
  });

  test("lets a matching clone policy veto the complete product clone", () => {
    const service = new ElementService();
    const source = createElement();
    service.registerElement({
      id: "not-cloneable",
      matchesElement: () => true,
      prepareCloneData: () => null,
    });

    expect(service.prepareClone({
      source,
      clone: { ...source, id: "clone" },
      createId: () => "id",
    })).toBeNull();
  });

  test("binds matching delete/restore lifecycle to the CRDT transaction", () => {
    const service = new ElementService();
    const element = createElement();
    const onDelete = vi.fn();
    const onRestore = vi.fn();
    service.registerElement({
      id: "text",
      matchesElement: (candidate) => candidate.data.type === "text",
      onDelete,
      onRestore,
    });
    service.registerElement({
      id: "rect",
      matchesElement: (candidate) => candidate.data.type === "rect",
      onDelete: vi.fn(),
    });
    let callbacks: {
      onCommit(args: { entity: TElement }): void;
      onRollback(args: { entity: TElement }): void;
    } | null = null;
    const builder = {
      deleteElement: vi.fn((_id, nextCallbacks) => {
        callbacks = nextCallbacks;
        return builder;
      }),
    };

    expect(service.deleteElement(element, builder as never)).toBe(builder);
    expect(builder.deleteElement).toHaveBeenCalledWith(element.id, expect.any(
      Object,
    ));
    callbacks!.onCommit({ entity: element });
    callbacks!.onRollback({ entity: element });
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onRestore).toHaveBeenCalledOnce();
  });

  test("rejects empty and duplicate definition IDs", () => {
    const service = new ElementService();
    expect(() => service.registerElement({
      id: " ",
      matchesElement: () => true,
    })).toThrow("non-empty");
    service.registerElement({
      id: "same",
      matchesElement: () => true,
    });
    expect(() => service.registerElement({
      id: "same",
      matchesElement: () => true,
    })).toThrow("already registered");
  });
});
