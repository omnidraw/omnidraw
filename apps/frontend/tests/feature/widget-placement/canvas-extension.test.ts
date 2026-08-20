import type { TCanvasExtensionContext } from "@omnidraw/canvas";
import { ThemeService } from "@omnidraw/theme";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createFrontendCanvasComposition } from "../../../src/shell/canvas/canvas-composition";
import { createFrontendWidgetPlacementExtension } from "../../../src/shell/framework/feature/widget-placement/canvas-extension";
import type {
  TWidgetPlacementCoordinator,
  TWidgetPlacementPort,
} from "../../../src/shell/framework/feature/widget-placement/WidgetPlacementCoordinator";
import type { TFrontendRuntime } from "../../../src/shell/runtime/frontend-runtime";

const guestExtensionFactory = vi.hoisted(() => vi.fn());

vi.mock("../../../src/shell/framework/feature/canvas-extension", () => ({
  createFrontendWidgetExtension: guestExtensionFactory,
}));

function createPlacementHarness(): Readonly<{
  placement: TWidgetPlacementCoordinator;
  port(): TWidgetPlacementPort | null;
  unregister: ReturnType<typeof vi.fn>;
}> {
  let port: TWidgetPlacementPort | null = null;
  const unregister = vi.fn();
  const placement: TWidgetPlacementCoordinator = {
    register(next) {
      port = next;
      return () => {
        if (port === next) port = null;
        unregister();
      };
    },
    available: () => port?.isAvailable() ?? false,
    subscribe(listener) {
      listener(port?.isAvailable() ?? false);
      return () => undefined;
    },
    beginPointerSession: (args) => port?.beginPointerSession(args) ?? false,
    async addToCanvas(args) {
      if (port === null) throw new Error("No placement port is registered.");
      await port.addToCanvas(args);
    },
    dispose() {
      port = null;
    },
  };
  return Object.freeze({ placement, port: () => port, unregister });
}

function createRuntime(
  placement: TWidgetPlacementCoordinator,
  signal = new AbortController().signal,
): TFrontendRuntime {
  return {
    ownerWindow: window,
    ownerDocument: document,
    signal,
    theme: { service: new ThemeService() },
    widgetPlacement: placement,
    store: {
      state: { sidebarVisible: true },
      set: vi.fn(),
    },
    rpc: {
      resumableStream: () => ({
        async *[Symbol.asyncIterator]() {
          // The composition test does not execute the database event stream.
        },
      }),
      generations: {
        snapshot: () => ({ connected: true, generation: 1 }),
        waitForConnectionAfter: async () => undefined,
      },
    },
    api: { safeRequest: vi.fn() },
    catalogInvalidation: { invalidate: vi.fn() },
    canvasHostRetirement: { registration: { register: () => () => undefined } },
    fork: () => () => undefined,
  } as unknown as TFrontendRuntime;
}

function createCanvasContext(container: HTMLDivElement): Readonly<{
  context: TCanvasExtensionContext;
  insertAtFront: ReturnType<typeof vi.fn>;
  setSelection: ReturnType<typeof vi.fn>;
  widgetsRegister: ReturnType<typeof vi.fn>;
}> {
  const insertAtFront = vi.fn();
  const setSelection = vi.fn();
  const widgetsRegister = vi.fn(() => {
    throw new Error("The eager placement extension must not install the guest host.");
  });
  const context = {
    config: {
      canvasId: "canvas-empty",
      container,
      notification: {
        showError: vi.fn(),
        showInfo: vi.fn(),
        showSuccess: vi.fn(),
      },
    },
    document: {
      item: () => null,
      items: () => [],
      node: () => null,
      nodes: () => [],
      childrenOf: () => [],
      query: async () => ({ items: [], nextCursor: null }),
      commit: vi.fn(),
      insertAtFront,
      setSelection,
      subscribe: () => () => undefined,
    },
    placement: {
      containsClientPoint: () => true,
      clientToWorld: (point: Readonly<{ x: number; y: number }>) => point,
      visibleWorldBounds: () => ({ minX: 0, minY: 0, maxX: 640, maxY: 480 }),
      viewportCenter: () => ({ x: 320, y: 240 }),
      createWidgetPreview: () => ({
        update: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
      }),
    },
    widgets: { register: widgetsRegister },
    trace: null,
    shell: {
      state: () => ({ ownership: "canvas" }),
      owns: () => false,
      subscribe: () => () => undefined,
      registerOverlay: () => () => undefined,
    },
  } as unknown as TCanvasExtensionContext;
  return Object.freeze({ context, insertAtFront, setSelection, widgetsRegister });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("frontend Canvas widget placement extension", () => {
  test("composition exposes placement on a fresh Canvas while the guest extension stays lazy", async () => {
    const placement = createPlacementHarness();
    const runtime = createRuntime(placement.placement);
    const composition = createFrontendCanvasComposition({
      canvasId: "canvas-empty",
      navigate: vi.fn(),
      ownerDocument: document,
      runtime,
    });
    expect(composition.dependencies.extensions?.map((extension) => extension.name)).toEqual([
      "omnidraw.frontend-widget-placement",
    ]);
    expect(composition.dependencies.extensionLoaders?.map((loader) => loader.name)).toContain(
      "omnidraw.frontend-widgets",
    );

    const container = document.createElement("div");
    document.body.append(container);
    const canvas = createCanvasContext(container);
    const installed = await composition.dependencies.extensions![0]!.install(canvas.context);
    expect(canvas.context.document.nodes()).toEqual([]);
    expect(runtime.widgetPlacement.available()).toBe(true);
    expect(placement.port()?.isAvailable()).toBe(true);
    expect(canvas.widgetsRegister).not.toHaveBeenCalled();
    expect(guestExtensionFactory).not.toHaveBeenCalled();

    await placement.placement.addToCanvas({
      reference: { source: "draft", widgetKey: "first-widget", catalogGeneration: 7 },
      bounds: { width: 240, height: 160 },
      label: "First widget",
    });
    expect(canvas.insertAtFront).toHaveBeenCalledOnce();
    const insertion = canvas.insertAtFront.mock.calls[0]![0];
    expect(insertion.source).toBe("omnidraw.widget-place");
    expect(insertion.node.transform.position).toEqual({ x: 200, y: 160 });
    expect(insertion.node.extensions["omnidraw:widget"].type).toBe("widget-preview");
    expect(insertion.node.titleBarColor).toEqual({
      space: "srgb",
      r: 217 / 255,
      g: 119 / 255,
      b: 6 / 255,
      a: 1,
    });
    expect(canvas.setSelection).toHaveBeenCalledWith(
      [insertion.node.id],
      { focusedNodeId: insertion.node.id },
    );

    await installed.dispose?.();
    expect(placement.port()).toBeNull();
    composition.dispose();
  });

  test("binds and releases preview automation with the eager pre-frame capability", async () => {
    const placement = createPlacementHarness();
    const runtime = createRuntime(placement.placement);
    const unbind = vi.fn();
    const bind = vi.fn(() => unbind);
    const extension = createFrontendWidgetPlacementExtension({
      runtime,
      placement: placement.placement,
      previewAutomation: {
        bind,
        ensure: async () => undefined,
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const canvas = createCanvasContext(container);

    const installed = await extension.install(canvas.context);
    expect(bind).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledWith(canvas.context.document);
    expect(placement.port()).not.toBeNull();
    expect(canvas.widgetsRegister).not.toHaveBeenCalled();

    await installed.dispose?.();
    expect(unbind).toHaveBeenCalledOnce();
    expect(placement.unregister).toHaveBeenCalledOnce();
  });

  test("releases preview automation when placement registration fails", () => {
    const registrationError = new Error("placement registration failed");
    const placement = {
      ...createPlacementHarness().placement,
      register: vi.fn(() => {
        throw registrationError;
      }),
    } satisfies TWidgetPlacementCoordinator;
    const runtime = createRuntime(placement);
    const unbind = vi.fn();
    const bind = vi.fn(() => unbind);
    const extension = createFrontendWidgetPlacementExtension({
      runtime,
      placement,
      previewAutomation: {
        bind,
        ensure: async () => undefined,
      },
    });
    const container = document.createElement("div");
    document.body.append(container);
    const canvas = createCanvasContext(container);

    expect(() => extension.install(canvas.context)).toThrow(registrationError);
    expect(bind).toHaveBeenCalledWith(canvas.context.document);
    expect(unbind).toHaveBeenCalledOnce();
  });
});
