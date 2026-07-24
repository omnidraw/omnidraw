import type { TCanvasDoc } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { SyncHook } from "@vibecanvas/tapable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TCanvasProjectedPortalContent } from "../../../src/engine/typed";
import {
  CanvasPortalService,
  type TCanvasPortalRenderHandle,
} from "../../../src/services/portal/CanvasPortalService";
import type { TCrdtChangeSummary } from "../../../src/services/crdt/CrdtService";
import { ensureDom } from "../../test-setup";
import { createCanvasDoc, createElement } from "../crdt/helpers";

function widgetDocument(): TCanvasDoc {
  const widget = createElement("widget", {
    data: {
      type: "ui-widget",
      kind: "weather",
      w: 320,
      h: 240,
      expanded: true,
      window: "contained",
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
  const initialContent: TCanvasProjectedPortalContent = {
    type: "ui-widget",
    kind: "weather",
    payload: { city: "Berlin" },
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
        onContentUpdate(listener) {
          contentListener = listener;
          return () => {
            contentListener = null;
          };
        },
      });
    },
    emitContent(content: TCanvasProjectedPortalContent) {
      contentListener?.(content);
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

  it("disposes a stale async renderer mount instead of adopting it", async () => {
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
    await vi.waitFor(() => expect(resolutions).toHaveLength(2));

    const newestDispose = vi.fn();
    resolutions[1]?.({ dispose: newestDispose });
    await Promise.resolve();
    const staleDispose = vi.fn();
    resolutions[0]?.({ dispose: staleDispose });
    const release = await mountPromise;

    expect(staleDispose).toHaveBeenCalledOnce();
    expect(newestDispose).not.toHaveBeenCalled();
    release();
    await vi.waitFor(() => expect(newestDispose).toHaveBeenCalledOnce());
    test.host.remove();
  });
});
