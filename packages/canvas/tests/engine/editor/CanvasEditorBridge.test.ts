// @vitest-environment jsdom
import type { TConnectorNode } from "@omnidraw/cangine";
import { describe, expect, it, vi } from "vitest";
import { CanvasEditorBridge } from "../../../src/engine/editor/CanvasEditorBridge";

function createHarness() {
  let contextMenuItems: ((context: unknown) => readonly unknown[]) | null = null;
  let editorListener: (() => void) | null = null;
  let sceneListener: ((change: {
    source?: string;
    updated: string[];
  }) => void) | null = null;
  const enterContentMode = vi.fn(() => true);
  const refresh = vi.fn();
  const lifecycle: string[] = [];
  let sceneNode: TConnectorNode | null = null;
  const onPathCommit = vi.fn(() => lifecycle.push("paths:commit"));
  const applyCommands = vi.fn(() => {
    lifecycle.push("paths:reconcile");
    return Promise.resolve({
      ok: true as const,
      revision: 1,
    });
  });
  const pathState = {
    mode: "idle",
    nodeId: null,
    segmentMode: null,
    activeAnchorId: null,
    cursor: null,
  } as const;
  const adapter = {
    createEditor: vi.fn(() => ({
      attach: vi.fn(() => lifecycle.push("editor:attach")),
      destroy: vi.fn(() => lifecycle.push("editor:destroy")),
      setActiveTool: vi.fn(),
      setSelection: vi.fn(),
      subscribe: vi.fn((listener: () => void) => {
        editorListener = listener;
        return vi.fn();
      }),
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
    createPathInteractionController: vi.fn(() => ({
      state: pathState,
      attach: vi.fn(() => lifecycle.push("paths:attach")),
      destroy: vi.fn(() => lifecycle.push("paths:destroy")),
      subscribe: vi.fn(() => vi.fn()),
    })),
    subscribeScene: vi.fn((listener) => {
      sceneListener = listener;
      return vi.fn();
    }),
    sceneNode: vi.fn(() => sceneNode),
    applyCommands,
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
      refresh,
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
    onPathCommit,
    resolveNavigationIntent: () => false,
  });
  if (contextMenuItems === null) {
    throw new Error("Expected context menu item resolver.");
  }
  return {
    bridge,
    contextMenuItems,
    selectedTarget,
    enterContentMode,
    publishEditorState() {
      editorListener?.();
    },
    publishSceneChange(change: { source?: string; updated: string[] }) {
      sceneListener?.(change);
    },
    setSceneNode(node: TConnectorNode) {
      sceneNode = node;
    },
    applyCommands,
    onPathCommit,
    refresh,
    lifecycle,
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

  it("refreshes the external transform overlay after editor selection writes", () => {
    const harness = createHarness();
    harness.bridge.attach();

    harness.publishEditorState();

    expect(harness.refresh).toHaveBeenCalledOnce();
  });

  it("attaches paths before the editor and destroys paths first", () => {
    const harness = createHarness();

    harness.bridge.attach();
    expect(harness.lifecycle).toEqual(["paths:attach", "editor:attach"]);

    harness.bridge.destroy();
    expect(harness.lifecycle.slice(-2)).toEqual([
      "paths:destroy",
      "editor:destroy",
    ]);
  });

  it("normalizes a committed child transform before publishing the CRDT commit", () => {
    const harness = createHarness();
    harness.setSceneNode({
      id: "element:widget-1:render",
      parentId: "element:widget-1",
      orderKey: "A",
      kind: "connector",
      transform: {
        position: { x: 100, y: 80 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      from: { type: "point", point: { x: 0, y: 0 } },
      to: { type: "point", point: { x: 200, y: 100 } },
      routing: { type: "straight" },
      stroke: {
        width: 2,
        paint: {
          type: "solid",
          color: { space: "srgb", r: 0, g: 0, b: 0, a: 1 },
        },
      },
    });
    harness.bridge.attach();

    harness.publishSceneChange({
      source: "cangine-editor:path-transform",
      updated: ["element:widget-1:render"],
    });

    expect(harness.applyCommands).toHaveBeenCalledWith({
      source: "vibecanvas:path-transform-reconcile",
      render: "none",
      commands: [{
        type: "upsert",
        node: expect.objectContaining({
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 },
            origin: { x: 0, y: 0 },
          },
        }),
      }],
    });
    expect(harness.onPathCommit).toHaveBeenCalledOnce();
    expect(harness.lifecycle.slice(-2)).toEqual([
      "paths:reconcile",
      "paths:commit",
    ]);
  });
});
