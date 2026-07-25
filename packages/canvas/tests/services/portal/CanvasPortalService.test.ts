import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TCanvasPortalViewportState,
  TCanvasProjectedPortalContent,
} from "../../../src/engine/typed";
import {
  CanvasPortalService,
  type TCanvasPortalRenderHandle,
} from "../../../src/services/portal/CanvasPortalService";
import type { TCrdtChangeSummary } from "../../../src/services/crdt/CrdtService";
import { ensureDom } from "../../test-setup";
import { createCanvasDoc, createElement } from "../crdt/helpers";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function widgetDocument(): TCanvasDoc {
  const widget = createElement("widget", {
    data: {
      type: "ui-widget",
      kind: "weather",
      w: 320,
      h: 240,
      expanded: true,
      payload: { city: "Berlin" },
    },
  });
  return createCanvasDoc({
    elements: { widget },
  });
}

function summary(elementId = "widget"): TCrdtChangeSummary {
  const element = createElement(elementId);
  return {
    revision: 1,
    origin: "remote",
    fullReload: false,
    elements: {
      added: [],
      updated: [elementId],
      deleted: [],
      changes: {
        [elementId]: {
          kind: "updated",
          before: element,
          after: element,
          changedFields: ["data"],
        },
      },
    },
    groups: {
      added: [],
      updated: [],
      deleted: [],
      changes: {},
    },
  };
}

function fixture() {
  let document = widgetDocument();
  const change = new SyncHook<[TCrdtChangeSummary]>();
  const service = new CanvasPortalService({
    doc: () => document,
    hooks: { change },
  } as never);
  const host = window.document.createElement("div");
  window.document.body.append(host);
  let contentListener:
    | ((content: TCanvasProjectedPortalContent) => void)
    | null = null;
  let viewportListener:
    | ((viewport: TCanvasPortalViewportState) => void)
    | null = null;
  const initialContent: TCanvasProjectedPortalContent = {
    type: "ui-widget",
    kind: "weather",
    payload: { city: "Berlin" },
  };
  const initialViewport: TCanvasPortalViewportState = {
    width: 320,
    height: 200,
    scale: 1,
    visible: true,
    distance: 0,
    occlusion: 0,
    interactive: true,
  };
  return {
    service,
    host,
    change,
    initialContent,
    setDocument(next: TCanvasDoc) {
      document = next;
    },
    mount() {
      return service.mount({
        portalId: "portal:widget",
        elementId: "widget",
        host,
        initialContent,
        initialViewport,
        onContentUpdate(listener) {
          contentListener = listener;
          return () => {
            contentListener = null;
          };
        },
        onViewportUpdate(listener) {
          viewportListener = listener;
          return () => {
            viewportListener = null;
          };
        },
      });
    },
    emitContent(content: TCanvasProjectedPortalContent) {
      contentListener?.(content);
    },
    emitViewport(viewport: TCanvasPortalViewportState) {
      viewportListener?.(viewport);
    },
  };
}

describe("CanvasPortalService", () => {
  beforeEach(() => ensureDom());

  it("refreshes fallback, renderer, updates, document deletion, and cleanup", async () => {
    const test = fixture();
    const dispose = vi.fn();
    const update = vi.fn();
    const release = await test.mount();

    expect(test.host.querySelector("[data-canvas-portal-fallback]"))
      .not.toBeNull();

    const unregister = test.service.registerRenderer({
      id: "weather",
      matches: (state) => state.content.type === "ui-widget"
        && state.content.kind === "weather",
      mount: ({ host, content }) => {
        const root = host.ownerDocument.createElement("div");
        root.dataset.hostedWidgetRoot = "true";
        root.textContent = content.type === "ui-widget"
          ? content.kind
          : "instance";
        host.replaceChildren(root);
        return { update, dispose };
      },
    });
    await vi.waitFor(() => {
      expect(test.host.querySelector("[data-hosted-widget-root='true']"))
        .not.toBeNull();
    });

    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Cairo" },
    });
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.objectContaining({
          payload: { city: "Cairo" },
        }),
      }));
    });

    test.setDocument(createCanvasDoc());
    test.change.call(summary());
    await vi.waitFor(() => {
      expect(test.host.textContent).toContain("no longer available");
    });
    expect(dispose).toHaveBeenCalledOnce();

    unregister();
    release();
    expect(test.host.childElementCount).toBe(0);
    test.host.remove();
  });

  it("serializes async mounts and disposes a superseded handle", async () => {
    const test = fixture();
    const resolutions: Array<
      (handle: TCanvasPortalRenderHandle) => void
    > = [];
    test.service.registerRenderer({
      id: "slow-weather",
      matches: () => true,
      mount: () => new Promise<TCanvasPortalRenderHandle>((resolve) => {
        resolutions.push(resolve);
      }),
    });

    const mountPromise = test.mount();
    await vi.waitFor(() => expect(resolutions).toHaveLength(1));
    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Cairo" },
    });
    await Promise.resolve();
    expect(resolutions).toHaveLength(1);

    const staleDispose = vi.fn();
    resolutions[0]?.({ dispose: staleDispose });
    await vi.waitFor(() => expect(resolutions).toHaveLength(2));
    const newestDispose = vi.fn();
    resolutions[1]?.({ dispose: newestDispose });
    const release = await mountPromise;

    expect(staleDispose).toHaveBeenCalledOnce();
    expect(newestDispose).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(newestDispose).toHaveBeenCalledOnce());
    test.host.remove();
  });

  it("coalesces delayed updates to the newest authoritative state", async () => {
    const test = fixture();
    const updates: TCanvasProjectedPortalContent[] = [];
    const gates: Array<ReturnType<typeof deferred<void>>> = [];
    const errors = vi.fn();
    test.service.hooks.error.tap(errors);
    test.service.registerRenderer({
      id: "weather",
      matches: () => true,
      mount: ({ host }) => {
        const root = host.ownerDocument.createElement("div");
        root.dataset.hostedWidgetRoot = "true";
        host.replaceChildren(root);
        return {
          dispose: vi.fn(),
          update: (state) => {
            updates.push(state.content);
            const gate = deferred<void>();
            gates.push(gate);
            return gate.promise;
          },
        };
      },
    });
    const release = await test.mount();

    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Cairo" },
    });
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Paris" },
    });
    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Rome" },
    });
    await Promise.resolve();
    expect(updates).toHaveLength(1);

    gates[0]?.reject(new Error("stale Cairo update"));
    await vi.waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1]).toMatchObject({ payload: { city: "Rome" } });
    expect(errors).not.toHaveBeenCalled();
    expect(test.host.querySelector("[data-canvas-portal-fallback]")).toBeNull();

    gates[1]?.resolve();
    await Promise.resolve();
    release();
    test.host.remove();
  });

  it("defers renderer replacement and final disposal behind in-flight work", async () => {
    const test = fixture();
    const updateGate = deferred<void>();
    const oldDispose = vi.fn();
    const newDispose = vi.fn();
    const oldUpdate = vi.fn(() => updateGate.promise);
    test.service.registerRenderer({
      id: "old",
      priority: 1,
      matches: () => true,
      mount: ({ host }) => {
        host.textContent = "old";
        return { dispose: oldDispose, update: oldUpdate };
      },
    });
    const release = await test.mount();
    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Cairo" },
    });
    await vi.waitFor(() => expect(oldUpdate).toHaveBeenCalledOnce());

    test.service.registerRenderer({
      id: "new",
      priority: 2,
      matches: () => true,
      mount: ({ host }) => {
        host.textContent = "new";
        return { dispose: newDispose };
      },
    });
    expect(oldDispose).not.toHaveBeenCalled();
    expect(test.host.textContent).toBe("old");

    updateGate.resolve();
    await vi.waitFor(() => expect(test.host.textContent).toBe("new"));
    expect(oldDispose).toHaveBeenCalledOnce();

    release();
    expect(test.host.childElementCount).toBe(0);
    await vi.waitFor(() => expect(newDispose).toHaveBeenCalledOnce());
    test.host.remove();
  });

  it("clears a disposed mount again after its in-flight update settles", async () => {
    const test = fixture();
    const gate = deferred<void>();
    const dispose = vi.fn();
    test.service.registerRenderer({
      id: "weather",
      matches: () => true,
      mount: ({ host }) => ({
        dispose,
        update: async () => {
          await gate.promise;
          host.textContent = "late stale content";
        },
      }),
    });
    const release = await test.mount();
    test.emitContent({
      type: "ui-widget",
      kind: "weather",
      payload: { city: "Cairo" },
    });
    await Promise.resolve();

    release();
    expect(test.host.childElementCount).toBe(0);
    gate.resolve();
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(test.host.childElementCount).toBe(0);
    test.host.remove();
  });

  it("forwards coalesced portal viewport state and unsubscribes on release", async () => {
    const test = fixture();
    const update = vi.fn();
    test.service.registerRenderer({
      id: "weather",
      matches: () => true,
      mount: () => ({
        dispose: vi.fn(),
        update,
      }),
    });
    const release = await test.mount();
    const next: TCanvasPortalViewportState = {
      width: 640,
      height: 360,
      scale: 2,
      visible: false,
      distance: 120,
      occlusion: 1,
      interactive: false,
    };

    test.emitViewport(next);
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        viewport: next,
      }));
    });

    release();
    const updateCount = update.mock.calls.length;
    test.emitViewport({
      ...next,
      visible: true,
      distance: 0,
      occlusion: 0,
    });
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(updateCount);
    test.host.remove();
  });
});
