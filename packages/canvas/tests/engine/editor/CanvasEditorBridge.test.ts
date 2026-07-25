// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CanvasEditorBridge } from "../../../src/engine/editor/CanvasEditorBridge";

function createHarness() {
  let contextMenuItems: ((context: unknown) => readonly unknown[]) | null = null;
  const enterContentMode = vi.fn(() => true);
  const adapter = {
    createEditor: vi.fn(() => ({
      attach: vi.fn(),
      destroy: vi.fn(),
      setSelection: vi.fn(),
    })),
    createMenuController: vi.fn(() => ({
      close: vi.fn(),
      destroy: vi.fn(),
    })),
    createWidgetInteractionController: vi.fn(() => ({
      state: {
        contentNodeId: null,
        frameNodeId: null,
        maximizedNodeId: null,
      },
      attach: vi.fn(),
      destroy: vi.fn(),
      subscribe: vi.fn(() => vi.fn()),
      modeFor: vi.fn(() => "inactive"),
      enterContentMode,
    })),
    createContextMenuController: vi.fn((options: {
      items(context: unknown): readonly unknown[];
    }) => {
      contextMenuItems = options.items;
      return {
        attach: vi.fn(),
        destroy: vi.fn(),
      };
    }),
  };
  const selectedTarget = { kind: "element", id: "widget-1" } as const;
  const bridge = new CanvasEditorBridge({
    adapter: adapter as never,
    host: document.createElement("div"),
    history: {
      canUndo: () => false,
      canRedo: () => false,
      retainedWeight: () => 0,
      subscribe: () => vi.fn(),
      undo: () => false,
      redo: () => false,
      clear: vi.fn(),
    },
    selection: {
      snapshot: () => ({
        selection: [selectedTarget],
        focused: selectedTarget,
      }),
      subscribe: () => vi.fn(),
      setSelection: vi.fn(),
      setFocusedTarget: vi.fn(),
    },
    getDocument: () => ({
      elements: {
        "widget-1": {
          data: { type: "ui-widget" },
        },
      },
    } as never),
    getProjectionIndex: () => ({
      elementNodeIds: {
        "widget-1": ["element:widget-1:render"],
      },
      groupNodeIds: {},
      nodeTargets: {
        "element:widget-1:render": selectedTarget,
      },
    }),
  });
  if (contextMenuItems === null) {
    throw new Error("Expected context menu item resolver.");
  }
  return {
    bridge,
    contextMenuItems,
    selectedTarget,
    enterContentMode,
  };
}

describe("CanvasEditorBridge", () => {
  it("uses selection fallback only for keyboard context menus", () => {
    const harness = createHarness();
    const provider = vi.fn(() => []);
    harness.bridge.registerContextMenuProvider(provider);

    harness.contextMenuItems({
      invocation: "mouse",
      anchor: { x: 10, y: 20 },
      hit: null,
    });
    expect(provider).toHaveBeenLastCalledWith(expect.objectContaining({
      invocation: "mouse",
      target: null,
    }));

    harness.contextMenuItems({
      invocation: "keyboard",
      anchor: { x: 10, y: 20 },
      hit: null,
    });
    expect(provider).toHaveBeenLastCalledWith(expect.objectContaining({
      invocation: "keyboard",
      target: harness.selectedTarget,
    }));
  });

  it("enters engine-owned content mode before product focus synchronization", () => {
    const harness = createHarness();

    expect(harness.bridge.focusWidgetContent("widget-1")).toBe(true);
    expect(harness.enterContentMode)
      .toHaveBeenCalledWith("element:widget-1:render");
  });
});
