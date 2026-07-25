// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type {
  TCanvasPortalRenderer,
  TElementElementDefinition,
} from "@vibecanvas/canvas/services";
import { SyncHook } from "@vibecanvas/tapable";
import { WidgetManagerService } from "../../src/widget/WidgetManagerService";

function element(): TElement {
  return {
    id: "widget-1",
    x: 10,
    y: 20,
    rotation: 0,
    zIndex: "z00000001",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    data: {
      type: "ui-widget",
      kind: "example",
      w: 320,
      h: 200,
      expanded: true,
      payload: {},
    },
    style: {},
  };
}

function viewport() {
  return {
    width: 320,
    height: 168,
    scale: 1,
    visible: true,
    distance: 0,
    occlusion: 0,
    interactive: true,
  } as const;
}

function widgetInstance(): TElement {
  return {
    ...element(),
    data: {
      type: "widget-instance",
      definitionId: "11111111-1111-4111-8111-111111111111",
      revisionId: "22222222-2222-4222-8222-222222222222",
      instanceId: "33333333-3333-4333-8333-333333333333",
      w: 320,
      h: 200,
      expanded: true,
    },
  };
}

function editorHarness() {
  let activationListener: ((activation: never) => void) | null = null;
  let presentationListener: (() => void) | null = null;
  let contentFocusHandler: ((elementId: string) => void) | null = null;
  const modes = new Map<string, "inactive" | "frame" | "content" | "maximized">();
  const focusWidgetContent = vi.fn((elementId: string) => {
    modes.set(elementId, "content");
    contentFocusHandler?.(elementId);
    presentationListener?.();
    return true;
  });
  return {
    sceneService: {
      editor: {
        subscribeWidgetActivation(listener: (activation: never) => void) {
          activationListener = listener;
          return () => {
            if (activationListener === listener) {
              activationListener = null;
            }
          };
        },
        subscribeWidgetPresentation(listener: () => void) {
          presentationListener = listener;
          return () => {
            if (presentationListener === listener) {
              presentationListener = null;
            }
          };
        },
        widgetMode(elementId: string) {
          return modes.get(elementId) ?? "inactive";
        },
        focusWidgetContent,
      },
    },
    activate(activation: unknown) {
      activationListener?.(activation as never);
    },
    setMode(
      elementId: string,
      mode: "inactive" | "frame" | "content" | "maximized",
    ) {
      modes.set(elementId, mode);
      presentationListener?.();
    },
    setContentFocusHandler(handler: (elementId: string) => void) {
      contentFocusHandler = handler;
    },
    focusWidgetContent,
  };
}

describe("WidgetManagerService portal lifecycle", () => {
  test("routes widget clone identity, payload, and cloneability through product policies", () => {
    const definitions: TElementElementDefinition[] = [];
    const editor = editorHarness();
    const service = new WidgetManagerService({
      browser: {
        document,
        createId: vi.fn(() => "fresh-instance"),
        now: vi.fn(() => 1),
      },
      crdtService: { doc: vi.fn(() => ({ elements: {} })) },
      contextMenuService: { close: vi.fn() },
      confirmDialogService: {},
      elementService: {
        registerElement: vi.fn((definition) => {
          definitions.push(definition);
          return vi.fn();
        }),
        unregisterElement: vi.fn(),
      },
      portalService: { registerRenderer: vi.fn(() => vi.fn()) },
      renderOrderService: {},
      selectionService: {
        focusedId: null,
        hooks: { change: new SyncHook<[]>() },
      },
      sceneService: editor.sceneService,
      toolService: {},
      product: vi.fn(),
    } as never);
    service.start({
      hooks: { elementPointerDown: new SyncHook() },
    } as never);
    const createClonePayload = vi.fn(() => ({ sessionId: "fresh-session" }));
    service.registerWidget({
      id: "example",
      createClonePayload,
    });
    service.registerWidget({
      id: "fixed",
      cloneable: false,
    });

    const source = element();
    const clone = { ...source, id: "clone-widget" };
    const configured = definitions.find((definition) => {
      return definition.id === "ui-widget:example";
    })!;
    expect(configured.prepareCloneData?.({
      source,
      clone,
      createId: () => "unused",
    })).toMatchObject({
      type: "ui-widget",
      payload: { sessionId: "fresh-session" },
    });
    expect(createClonePayload).toHaveBeenCalledWith({});

    const fixed = {
      ...source,
      data: { ...source.data, kind: "fixed" },
    } as TElement;
    const disabled = definitions.find((definition) => {
      return definition.id === "ui-widget:fixed";
    })!;
    expect(disabled.prepareCloneData?.({
      source: fixed,
      clone: { ...fixed, id: "clone-fixed" },
      createId: () => "unused",
    })).toBeNull();

    const neutral = {
      ...source,
      data: {
        type: "widget-instance",
        w: 320,
        h: 200,
        definitionId: "definition",
        revisionId: "revision",
        instanceId: "source-instance",
        stateDocumentId: "source-state",
        expanded: true,
      },
    } as TElement;
    const generic = definitions.find((definition) => {
      return definition.id === "__widget-product-policy";
    })!;
    const neutralData = generic.prepareCloneData?.({
      source: neutral,
      clone: { ...neutral, id: "clone-neutral" },
      createId: () => "fresh-instance",
    });
    expect(neutralData).toMatchObject({
      type: "widget-instance",
      instanceId: "fresh-instance",
    });
    expect(neutralData).not.toHaveProperty("stateDocumentId");

    service.stop();
  });

  test("keeps mounted widget DOM stable for frame-only projection updates", () => {
    let renderer: {
      mount(args: {
        host: HTMLDivElement;
        element: TElement;
        content: {
          type: "ui-widget";
          kind: string;
          payload?: Record<string, boolean>;
        };
      }): {
        update(state: {
          element: TElement;
          content: {
            type: "ui-widget";
            kind: string;
            payload?: Record<string, boolean>;
          };
        }): void;
        dispose(): void;
      };
    } | null = null;
    const selectionChange = new SyncHook<[]>();
    const editor = editorHarness();
    const service = new WidgetManagerService({
      browser: {
        document,
        createId: vi.fn(() => "id"),
        now: vi.fn(() => 1),
      },
      crdtService: { doc: vi.fn(() => ({ elements: {} })) },
      contextMenuService: { close: vi.fn() },
      confirmDialogService: {},
      elementService: {
        registerElement: vi.fn(() => vi.fn()),
      },
      portalService: {
        registerRenderer: vi.fn((next) => {
          renderer = next;
          return vi.fn();
        }),
      },
      renderOrderService: {},
      selectionService: {
        focusedId: "widget-1",
        hooks: { change: selectionChange },
      },
      sceneService: editor.sceneService,
      toolService: {},
      product: vi.fn(),
    } as never);
    service.start({
      hooks: {
        elementPointerDown: new SyncHook(),
      },
    } as never);
    if (renderer === null) {
      throw new Error("Expected portal renderer registration.");
    }

    const host = document.createElement("div");
    const leakedPointer = vi.fn();
    host.addEventListener("pointerdown", leakedPointer);
    const initial = element();
    const content = {
      type: "ui-widget" as const,
      kind: "example",
      payload: {},
    };
    const mount = renderer.mount({
      host,
      element: initial,
      content,
      viewport: viewport(),
    });
    const firstSurface = host.querySelector("[data-widget-portal-surface]");
    const contentRoot = host.querySelector<HTMLElement>(
      "[data-widget-content-root]",
    );
    contentRoot?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 299,
      clientY: 100,
    }));
    expect(leakedPointer).not.toHaveBeenCalled();

    editor.setMode(initial.id, "maximized");
    mount.update({
      element: {
        ...initial,
        x: 80,
        y: 90,
      } as TElement,
      content,
      viewport: viewport(),
    });
    expect(host.querySelector("[data-widget-portal-surface]")).toBe(firstSurface);
    contentRoot?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 299,
      clientY: 100,
    }));
    expect(leakedPointer).not.toHaveBeenCalled();

    editor.setMode(initial.id, "frame");
    mount.update({ element: initial, content, viewport: viewport() });
    contentRoot?.dispatchEvent(new MouseEvent("pointerdown", {
      bubbles: true,
      clientX: 299,
      clientY: 100,
    }));
    expect(leakedPointer).not.toHaveBeenCalled();

    mount.update({
      element: initial,
      content: {
        ...content,
        payload: { changed: true },
      },
      viewport: viewport(),
    });
    expect(host.querySelector("[data-widget-portal-surface]"))
      .not.toBe(firstSurface);

    mount.dispose();
    service.stop();
  });

  test("projects titles and actions into engine chrome while content owns focus", () => {
    const current = element();
    const definitions: TElementElementDefinition[] = [];
    const selectionChange = new SyncHook<[]>();
    const invalidateProjection = vi.fn();
    const action = vi.fn();
    const editor = editorHarness();
    let selected: Array<{ kind: "element"; id: string }> = [{
      kind: "element",
      id: current.id,
    }];
    let focused: { kind: "element"; id: string } | null = null;
    let renderer: {
      mount(args: {
        host: HTMLDivElement;
        element: TElement;
        content: { type: "ui-widget"; kind: string };
      }): { dispose(): void };
    } | null = null;
    const selectionService = {
      get focusedId() {
        return focused?.id ?? null;
      },
      get selection() {
        return selected;
      },
      hooks: { change: selectionChange },
      setSelection(next: typeof selected) {
        selected = [...next];
        selectionChange.call();
        return true;
      },
      setFocusedTarget(
        next: typeof focused,
        _options?: { allowUnselected?: boolean },
      ) {
        focused = next;
        selectionChange.call();
        return true;
      },
    };
    editor.setContentFocusHandler((elementId) => {
      selected = [];
      focused = { kind: "element", id: elementId };
      selectionChange.call();
    });
    const service = new WidgetManagerService({
      browser: { document },
      crdtService: {
        doc: () => ({ elements: { [current.id]: current } }),
      },
      contextMenuService: { close: vi.fn() },
      confirmDialogService: {},
      elementService: {
        registerElement: vi.fn((definition) => {
          definitions.push(definition);
          return vi.fn();
        }),
        unregisterElement: vi.fn(),
        invalidateProjection,
      },
      portalService: {
        registerRenderer: vi.fn((next) => {
          renderer = next;
          return vi.fn();
        }),
      },
      renderOrderService: {},
      selectionService,
      sceneService: editor.sceneService,
      toolService: {},
      product: vi.fn(),
    } as never);
    service.registerWidget({
      id: "example",
      getTitle: () => "Draft dashboard",
      titleBarActions: [{
        id: "settings",
        label: "Settings",
      }],
      renderDom: ({ root, titleBar }) => {
        root.textContent = "interactive";
        titleBar?.onAction("settings", action);
        titleBar?.setActionState("settings", {
          label: "Back to dashboard",
          pressed: true,
        });
      },
    });
    service.start({ hooks: {} } as never);
    if (renderer === null) {
      throw new Error("Expected widget renderer.");
    }

    const host = document.createElement("div");
    const mounted = renderer.mount({
      host,
      element: current,
      content: { type: "ui-widget", kind: "example" },
      viewport: viewport(),
    });
    const policy = definitions.find((definition) => {
      return definition.id === "__widget-product-policy";
    });
    if (policy?.getWidgetFrame === undefined) {
      throw new Error("Expected widget frame policy.");
    }
    const projectFrame = () => policy.getWidgetFrame?.({
      element: current,
    });
    expect(projectFrame()).toMatchObject({
      title: "Draft dashboard",
      headerItems: expect.arrayContaining([
        expect.objectContaining({
          type: "button",
          id: "settings",
          label: "Back to dashboard",
        }),
      ]),
    });
    expect(host.querySelector("[data-widget-title-action]")).toBeNull();

    const content = host.querySelector<HTMLElement>(
      "[data-widget-content-root]",
    );
    content?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(editor.focusWidgetContent).toHaveBeenCalledWith(current.id);
    expect(selected).toEqual([]);
    expect(focused).toEqual({ kind: "element", id: current.id });
    expect(content?.dataset.widgetContentFocused).toBe("true");

    editor.activate({
      type: "header-button",
      elementId: current.id,
      itemId: "settings",
    });
    expect(action).toHaveBeenCalledOnce();
    expect(selected).toEqual([{ kind: "element", id: current.id }]);
    expect(focused).toBeNull();
    expect(content?.dataset.widgetContentFocused).toBe("false");
    expect(invalidateProjection).toHaveBeenCalled();

    mounted.dispose();
    service.stop();
  });

  test("uses stable minimize control identity to restore a minimized widget", () => {
    let current = {
      ...element(),
      data: {
        ...element().data,
        expanded: false,
      },
    } as TElement;
    const editor = editorHarness();
    const patchElement = vi.fn((
      _id: string,
      _field: string,
      data: TElement["data"],
    ) => {
      current = { ...current, data } as TElement;
      return {
        commit: () => ({
          rollback: vi.fn(),
          redoOps: [],
        }),
      };
    });
    const service = new WidgetManagerService({
      browser: { document },
      crdtService: {
        doc: () => ({ elements: { [current.id]: current } }),
        build: () => ({ patchElement }),
      },
      contextMenuService: { close: vi.fn() },
      confirmDialogService: {},
      elementService: {
        registerElement: vi.fn(() => vi.fn()),
      },
      portalService: {
        registerRenderer: vi.fn(() => vi.fn()),
      },
      renderOrderService: {},
      selectionService: {
        focusedId: null,
        hooks: { change: new SyncHook<[]>() },
        setSelection: vi.fn(),
        setFocusedTarget: vi.fn(),
      },
      sceneService: editor.sceneService,
      toolService: {},
      product: vi.fn(),
    } as never);
    service.start({ hooks: {} } as never);

    editor.activate({
      type: "minimize",
      elementId: current.id,
    });

    expect(current.data).toMatchObject({
      expanded: true,
    });
    service.stop();
  });

  test("bridges portal focus, collapse, and canvas maximize into the Capsule owner", async () => {
    let current = widgetInstance();
    let focusedId: string | null = null;
    const selectionChange = new SyncHook<[]>();
    const documentChange = new SyncHook<[]>();
    const editor = editorHarness();
    let renderer: TCanvasPortalRenderer | null = null;
    const runtimeOwner = {
      setProps: vi.fn(),
      setViewport: vi.fn(),
      setFocused: vi.fn(),
      freeze: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      diagnostics: vi.fn(() => null),
      destroy: vi.fn(async () => undefined),
    };
    const renderOwned = vi.fn(() => runtimeOwner);
    const service = new WidgetManagerService({
      browser: { document },
      crdtService: {
        doc: () => ({ elements: { [current.id]: current } }),
        hooks: { change: documentChange },
      },
      contextMenuService: { close: vi.fn() },
      confirmDialogService: {},
      elementService: {
        registerElement: vi.fn(() => vi.fn()),
        invalidateProjection: vi.fn(),
      },
      portalService: {
        registerRenderer: vi.fn((next) => {
          renderer = next;
          return vi.fn();
        }),
      },
      renderOrderService: {},
      selectionService: {
        get focusedId() {
          return focusedId;
        },
        selection: [],
        hooks: { change: selectionChange },
      },
      sceneService: editor.sceneService,
      toolService: {},
      product: vi.fn(),
      neutralHost: {
        canvasId: "canvas",
        runtime: { renderOwned } as never,
      },
    } as never);
    service.start({
      hooks: { elementPointerDown: new SyncHook() },
    } as never);
    if (renderer === null) {
      throw new Error("Expected widget renderer registration.");
    }
    const host = document.createElement("div");
    const mounted = await renderer.mount({
      host,
      portalId: "portal:widget",
      element: current,
      content: {
        type: "widget-instance",
        definitionId: current.data.type === "widget-instance"
          ? current.data.definitionId
          : "",
        revisionId: current.data.type === "widget-instance"
          ? current.data.revisionId
          : "",
        instanceId: current.data.type === "widget-instance"
          ? current.data.instanceId
          : "",
      },
      viewport: viewport(),
    });
    if (mounted === undefined || typeof mounted === "function") {
      throw new Error("Expected widget render handle.");
    }

    expect(runtimeOwner.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visibility: "visible",
        priority: 60,
      }),
    );

    focusedId = current.id;
    selectionChange.call();
    expect(runtimeOwner.setFocused).toHaveBeenCalledWith(
      true,
      { preventScroll: true },
    );
    expect(runtimeOwner.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({ priority: 90 }),
    );

    current = {
      ...current,
      data: {
        ...current.data,
        expanded: false,
      },
    } as TElement;
    editor.setMode(current.id, "maximized");
    await mounted.update?.({
      element: current,
      content: {
        type: "widget-instance",
        definitionId: current.data.type === "widget-instance"
          ? current.data.definitionId
          : "",
        revisionId: current.data.type === "widget-instance"
          ? current.data.revisionId
          : "",
        instanceId: current.data.type === "widget-instance"
          ? current.data.instanceId
          : "",
      },
      viewport: {
        ...viewport(),
        visible: false,
        interactive: false,
        occlusion: 1,
      },
    });
    expect(runtimeOwner.freeze).toHaveBeenCalledWith(
      "canvas-widget-collapsed",
    );
    expect(runtimeOwner.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visibility: "hidden",
        priority: -100,
      }),
    );

    current = {
      ...current,
      data: {
        ...current.data,
        expanded: true,
      },
    } as TElement;
    await mounted.update?.({
      element: current,
      content: {
        type: "widget-instance",
        definitionId: current.data.type === "widget-instance"
          ? current.data.definitionId
          : "",
        revisionId: current.data.type === "widget-instance"
          ? current.data.revisionId
          : "",
        instanceId: current.data.type === "widget-instance"
          ? current.data.instanceId
          : "",
      },
      viewport: viewport(),
    });
    expect(runtimeOwner.resume).toHaveBeenLastCalledWith(
      "canvas-widget-maximized",
    );
    expect(runtimeOwner.setViewport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        visibility: "visible",
        priority: 100,
      }),
    );

    await mounted.dispose();
    await mounted.dispose();
    await vi.waitFor(() => {
      expect(runtimeOwner.destroy).toHaveBeenCalledOnce();
    });
    service.stop();
  });
});
