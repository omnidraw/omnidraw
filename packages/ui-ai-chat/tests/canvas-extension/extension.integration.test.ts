import { ThemeService } from "@vibecanvas/service-theme";
import { buildRuntime } from "@vibecanvas/canvas/runtime";
import { LOCAL_BROWSER_TENANT_SCOPE } from "@vibecanvas/canvas/CONSTANTS";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiChatCanvasExtension } from "../../src/canvas-extension";
import { DRAFT_PREVIEW_FRAME_GAP, DRAFT_PREVIEW_WIDGET_KIND } from "../../src/draft-preview/CONSTANTS";
import type { DraftPreviewFrameService } from "../../src/draft-preview/DraftPreviewFrameService";
import { fnDraftPreviewElementId } from "../../src/draft-preview/fn.element-id";
import type { TElement, TGroup } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  createMockDocHandle,
  createTestApplication,
  createTestChatBrowser,
  createTestContainer,
  createTestWidgetBrowser,
  ensureCanvasDom,
} from "../test-setup";

describe("AI Chat canvas extension", () => {
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  it("registers AI/widget capabilities before hydration and tears down its stream and portal", async () => {
    ensureCanvasDom();
    container = createTestContainer();

    let resolveNext: ((value: IteratorResult<unknown>) => void) | undefined;
    const returnStream = vi.fn(async () => {
      resolveNext?.({ done: true, value: undefined });
      return { done: true, value: undefined } as IteratorResult<unknown>;
    });
    const actorEvents = vi.fn(async () => [null, {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>((resolve) => {
            resolveNext = resolve;
          }),
          return: returnStream,
        };
      },
    }] as const);
    const listDefinitions = vi.fn(async () => [null, []] as const);

    const extension = createAiChatCanvasExtension({
      chatApi: {} as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: listDefinitions, get: vi.fn() },
            instances: {} as never,
            events: actorEvents,
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: createTestWidgetBrowser(),
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "extension-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle: createMockDocHandle(),
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();

    expect(runtime.services.require("tool").getTool("ai")?.label).toBe("AI Chat");
    expect(container.querySelector("#widget-portal")).not.toBeNull();
    expect(listDefinitions).toHaveBeenCalledOnce();
    expect(actorEvents).not.toHaveBeenCalled();

    await runtime.shutdown();

    expect(runtime.services.require("tool").getTool("ai")).toBeUndefined();
    expect(container.querySelector("#widget-portal")).toBeNull();
    expect(returnStream).not.toHaveBeenCalled();
  });

  it("closes actor and agent streams that resolve after runtime shutdown", async () => {
    ensureCanvasDom();
    container = createTestContainer();

    let resolveActorEvents!: (value: readonly [null, AsyncIterable<unknown>]) => void;
    let resolveAgentEvents!: (value: readonly [null, AsyncIterable<unknown>]) => void;
    const actorEvents = vi.fn(() => new Promise<readonly [null, AsyncIterable<unknown>]>((resolve) => {
      resolveActorEvents = resolve;
    }));
    const agentEvents = vi.fn(() => new Promise<readonly [null, AsyncIterable<unknown>]>((resolve) => {
      resolveAgentEvents = resolve;
    }));
    const actorReturn = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>);
    const agentReturn = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>);
    const stream = (returnStream: typeof actorReturn): AsyncIterable<unknown> => ({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => {}),
          return: returnStream,
        };
      },
    });

    const extension = createAiChatCanvasExtension({
      chatApi: {} as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: {
              list: vi.fn(async () => [null, [{
                name: 'Legacy',
                health: 'ready',
                error: null,
                updated_at: '2026-07-22T00:00:00.000Z',
              }]] as const),
              get: vi.fn(async () => [null, {
                def: {
                  name: 'Legacy',
                  widget: { tool: { label: 'Legacy', icon: null } },
                },
                widgetCode: [{ path: 'main.ts', content: 'export default {}' }],
              }] as const),
            },
            instances: {} as never,
            events: actorEvents,
          },
          agent: { events: agentEvents },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: createTestWidgetBrowser(),
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "late-stream-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle: createMockDocHandle(),
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    await runtime.shutdown();
    resolveActorEvents([null, stream(actorReturn)]);
    resolveAgentEvents([null, stream(agentReturn)]);

    await vi.waitFor(() => {
      expect(actorReturn).toHaveBeenCalledOnce();
      expect(agentReturn).toHaveBeenCalledOnce();
    });
  });

  it("creates, focuses, and refreshes one persisted Preview frame per draft beside the originating frame", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const origin: TElement = {
      id: "chat-origin",
      x: 140,
      y: 90,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "unregistered-chat-origin",
        w: 420,
        h: 480,
        expanded: true,
        window: "contained",
        payload: {},
      },
      style: {},
    };
    const docHandle = createMockDocHandle({ elements: { [origin.id]: origin } });
    const getDraft = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, {
      draftId,
      name: draftId,
      displayName: draftId,
      revision: `revision-${draftId}`,
    }] as const);
    const previewFailure = (draftId: string) => ({
      ready: false as const,
      draftId,
      revision: `revision-${draftId}`,
      currentRevision: `revision-${draftId}`,
      reason: "validation-failed" as const,
      message: "Fix validation errors before Preview can run.",
      diagnostics: ["widget/main.ts: invalid"],
    });
    const getPreview = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, {
      ready: false,
      draftId,
      revision: `revision-${draftId}`,
      currentRevision: `revision-${draftId}`,
      reason: "not-built",
      message: "Preview has not been built.",
      diagnostics: [],
    }] as const);
    const buildPreview = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, previewFailure(draftId)] as const);
    const refreshPreview = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, previewFailure(draftId)] as const);
    const closePreview = vi.fn(async ({ draftId, expectedRevision }: { draftId: string; expectedRevision: string }) => [undefined, {
      closed: false,
      draftId,
      revision: expectedRevision,
    }] as const);
    let id = 0;
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgetDraft: { get: getDraft },
            widgetPreview: {
              get: getPreview,
              build: buildPreview,
              refresh: refreshPreview,
              reset: refreshPreview,
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: {} },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: { ...createTestWidgetBrowser(), createId: () => `preview-frame-${++id}` },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "preview-open-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    const previewFrames = (runtime.services as unknown as { require(name: string): unknown }).require("draft-preview-frame") as DraftPreviewFrameService;
    await previewFrames.open({ draftName: "Weather", originChatElementId: origin.id });

    const first = Object.values(docHandle.doc().elements).find((element) => element.data.type === "ui-widget" && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND);
    expect(first).toBeDefined();
    expect(first?.id).toBe(fnDraftPreviewElementId("Weather"));
    expect(first?.x).toBe(origin.x + origin.data.w + DRAFT_PREVIEW_FRAME_GAP);
    expect(first?.y).toBe(origin.y);
    expect(first?.data.type === "ui-widget" ? first.data.payload : undefined).toEqual({
      draftId: "Weather",
      pinnedRevision: "revision-Weather",
      originChatElementId: origin.id,
    });
    expect(runtime.services.require("selection").focusedId).toBe(first?.id);
    const firstNode = runtime.services.require("scene").staticForegroundLayer.findOne(`#${first?.id}`);
    expect(firstNode).not.toBeNull();
    expect(runtime.services.require("element").createDragClone({ node: firstNode!, selection: [firstNode!] })).toBe(false);

    const firstPosition = { x: first?.x, y: first?.y };
    await previewFrames.open({ draftName: "Weather", originChatElementId: origin.id });
    expect(Object.values(docHandle.doc().elements).filter((element) => element.data.type === "ui-widget" && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND)).toHaveLength(1);
    expect(refreshPreview).toHaveBeenCalledWith({
      draftId: "Weather",
      previewId: "preview-frame-1",
      expectedRevision: "revision-Weather",
    });
    expect({ x: first?.x, y: first?.y }).toEqual(firstPosition);

    await previewFrames.open({ draftName: "Timer", originChatElementId: origin.id });
    expect(Object.values(docHandle.doc().elements).filter((element) => element.data.type === "ui-widget" && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND)).toHaveLength(2);
    expect(getDraft).toHaveBeenCalledTimes(3);

    const vanishingReady = {
      ready: true as const,
      draftId: "Vanishing",
      name: "Vanishing",
      revision: "revision-Vanishing",
      currentRevision: "revision-Vanishing",
      stale: false,
      manifest: {},
      sources: { "main.ts": "export default {}" },
      snapshot: { state: "idle", context: {} },
      diagnostics: [],
    };
    let resolveVanishingBuild!: (value: readonly [undefined, typeof vanishingReady]) => void;
    buildPreview.mockImplementationOnce(() => new Promise((resolve) => {
      resolveVanishingBuild = resolve;
    }) as never);
    const vanishingOpen = previewFrames.open({ draftName: "Vanishing", originChatElementId: origin.id });
    await vi.waitFor(() => expect(buildPreview).toHaveBeenCalledTimes(3));
    runtime.services.require("scene").staticForegroundLayer.findOne(`#${origin.id}`)?.destroy();
    resolveVanishingBuild([undefined, vanishingReady]);

    await expect(vanishingOpen).rejects.toThrow("could not be located");
    await vi.waitFor(() => expect(closePreview).toHaveBeenCalledWith({
      draftId: "Vanishing",
      previewId: "preview-frame-3",
      expectedRevision: "revision-Vanishing",
    }));
    expect(Object.values(docHandle.doc().elements).filter((element) => {
      return element.data.type === "ui-widget"
        && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND
        && element.data.payload?.draftId === "Vanishing";
    })).toHaveLength(0);

    buildPreview.mockRejectedValueOnce(new Error("Preview build response was lost."));
    await expect(previewFrames.open({ draftName: "Lost", originChatElementId: origin.id })).rejects.toThrow("response was lost");
    expect(closePreview).toHaveBeenCalledWith({
      draftId: "Lost",
      previewId: "preview-frame-4",
      expectedRevision: "revision-Lost",
    });

    await runtime.shutdown();
    expect(closePreview).toHaveBeenCalledTimes(4);
    expect(closePreview).toHaveBeenNthCalledWith(3, {
      draftId: "Weather",
      previewId: "preview-frame-1",
      expectedRevision: "revision-Weather",
    });
    expect(closePreview).toHaveBeenNthCalledWith(4, {
      draftId: "Timer",
      previewId: "preview-frame-2",
      expectedRevision: "revision-Timer",
    });
  });

  it("reuses a collaborator frame that arrives during build and releases the prepared owner", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const origin: TElement = {
      id: "collaborator-chat-origin",
      x: 100,
      y: 80,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "unregistered-chat-origin",
        w: 400,
        h: 440,
        expanded: true,
        window: "contained",
        payload: {},
      },
      style: {},
    };
    const remoteFrame: TElement = {
      id: "remote-collaborator-preview",
      x: 700,
      y: 120,
      rotation: 0,
      zIndex: "b0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 2,
      updatedAt: 2,
      data: {
        type: "ui-widget",
        kind: DRAFT_PREVIEW_WIDGET_KIND,
        w: 420,
        h: 440,
        expanded: true,
        window: "contained",
        payload: {
          draftId: "Collaborative",
          pinnedRevision: "revision-collaborative",
          originChatElementId: origin.id,
        },
      },
      style: {},
    };
    const docHandle = createMockDocHandle({ elements: { [origin.id]: origin } });
    const summary = {
      draftId: "Collaborative",
      name: "Collaborative",
      displayName: "Collaborative",
      revision: "revision-collaborative",
    };
    const readyResult = {
      ready: true as const,
      draftId: summary.draftId,
      name: summary.name,
      revision: summary.revision,
      currentRevision: summary.revision,
      stale: false,
      manifest: {},
      sources: { "main.ts": "export default {}" },
      snapshot: { state: "idle", context: {} },
      diagnostics: [],
    };
    const failedResult = {
      ready: false as const,
      draftId: summary.draftId,
      revision: summary.revision,
      currentRevision: summary.revision,
      reason: "validation-failed" as const,
      message: "Fix validation before Preview can run.",
      diagnostics: [],
    };
    let resolvePreparedBuild!: (value: readonly [undefined, typeof readyResult]) => void;
    const buildPreview = vi.fn()
      .mockImplementationOnce(() => new Promise<readonly [undefined, typeof readyResult]>((resolve) => {
        resolvePreparedBuild = resolve;
      }))
      .mockResolvedValue([undefined, failedResult]);
    const refreshPreview = vi.fn(async () => [undefined, failedResult] as const);
    const closePreview = vi.fn(async ({ draftId, expectedRevision }: { draftId: string; expectedRevision: string }) => [undefined, {
      closed: true,
      draftId,
      revision: expectedRevision,
    }] as const);
    const generatedOwners = ["prepared-collaborator-owner", "mounted-collaborator-owner"];
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn(async () => [undefined, summary] as const) },
            widgetPreview: {
              get: vi.fn(async () => [undefined, {
                ...failedResult,
                reason: "not-built",
                message: "Preview has not been built.",
              }] as const),
              build: buildPreview,
              refresh: refreshPreview,
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: {} },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: {
        ...createTestWidgetBrowser(),
        createId: () => generatedOwners.shift() ?? "unexpected-collaborator-owner",
      },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "collaborator-preview-race-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    const previewFrames = (runtime.services as unknown as { require(name: string): unknown }).require("draft-preview-frame") as DraftPreviewFrameService;
    const opening = previewFrames.open({ draftName: summary.draftId, originChatElementId: origin.id });
    await vi.waitFor(() => expect(buildPreview).toHaveBeenCalledOnce());
    docHandle.change((doc) => { doc.elements[remoteFrame.id] = remoteFrame });
    resolvePreparedBuild([undefined, readyResult]);
    await opening;

    expect(Object.values(docHandle.doc().elements).filter((element) => {
      return element.data.type === "ui-widget"
        && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND
        && element.data.payload?.draftId === summary.draftId;
    })).toEqual([remoteFrame]);
    expect(docHandle.doc().elements[fnDraftPreviewElementId(summary.draftId)]).toBeUndefined();
    expect(runtime.services.require("selection").focusedId).toBe(remoteFrame.id);
    expect(closePreview).toHaveBeenCalledWith({
      draftId: summary.draftId,
      previewId: "prepared-collaborator-owner",
      expectedRevision: summary.revision,
    });

    await runtime.shutdown();
    expect(closePreview).toHaveBeenCalledWith({
      draftId: summary.draftId,
      previewId: "mounted-collaborator-owner",
      expectedRevision: summary.revision,
    });
  });

  it("gives a remounted frame a fresh backend owner while an obsolete refresh drains", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const origin: TElement = {
      id: "remount-chat-origin",
      x: 40,
      y: 60,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "unregistered-chat-origin",
        w: 400,
        h: 440,
        expanded: true,
        window: "contained",
        payload: {},
      },
      style: {},
    };
    const docHandle = createMockDocHandle({ elements: { [origin.id]: origin } });
    const summary = {
      draftId: "Remounted",
      name: "Remounted",
      displayName: "Remounted",
      revision: "revision-remounted",
    };
    const failure = {
      ready: false as const,
      draftId: "Remounted",
      revision: summary.revision,
      currentRevision: summary.revision,
      reason: "validation-failed" as const,
      message: "Fix validation before Preview can run.",
      diagnostics: [],
    };
    const readyResult = {
      ready: true as const,
      draftId: "Remounted",
      name: "Remounted",
      revision: summary.revision,
      currentRevision: summary.revision,
      stale: false,
      manifest: {},
      sources: { "main.ts": "export default {}" },
      snapshot: { state: "idle", context: {} },
      diagnostics: [],
    };
    let resolveRefresh!: (value: readonly [undefined, typeof readyResult]) => void;
    const refreshPreview = vi.fn(() => new Promise<readonly [undefined, typeof readyResult]>((resolve) => {
      resolveRefresh = resolve;
    }));
    const getPreview = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, {
      ...failure,
      draftId,
      reason: "not-built",
      message: "Preview has not been built.",
    }] as const);
    const buildPreview = vi.fn(async () => [undefined, failure] as const);
    const closePreview = vi.fn(async ({ draftId, expectedRevision }: { draftId: string; expectedRevision: string }) => [undefined, {
      closed: true,
      draftId,
      revision: expectedRevision,
    }] as const);
    const generatedIds = ["remounted-owner-old", "remounted-owner-new"];
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn(async () => [undefined, summary] as const) },
            widgetPreview: {
              get: getPreview,
              build: buildPreview,
              refresh: refreshPreview,
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: {} },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: {
        ...createTestWidgetBrowser(),
        createId: () => generatedIds.shift() ?? "unexpected-owner",
      },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "preview-remount-owner-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    const previewFrames = (runtime.services as unknown as { require(name: string): unknown }).require("draft-preview-frame") as DraftPreviewFrameService;
    await previewFrames.open({ draftName: "Remounted", originChatElementId: origin.id });
    const frame = docHandle.doc().elements[fnDraftPreviewElementId("Remounted")]!;
    expect(buildPreview).toHaveBeenCalledWith({
      draftId: "Remounted",
      previewId: "remounted-owner-old",
      expectedRevision: summary.revision,
    });

    const reopening = previewFrames.open({ draftName: "Remounted", originChatElementId: origin.id });
    await vi.waitFor(() => expect(refreshPreview).toHaveBeenCalledOnce());
    const remountedRoot = document.createElement("div");
    const cleanupRemount = previewFrames.mount({ root: remountedRoot, element: frame });
    await vi.waitFor(() => expect(getPreview).toHaveBeenCalledWith({
      draftId: "Remounted",
      previewId: "remounted-owner-new",
    }));

    expect(closePreview).not.toHaveBeenCalledWith(expect.objectContaining({ previewId: "remounted-owner-new" }));

    const stopping = previewFrames.stop();
    const lateRoot = document.createElement("div");
    const cleanupLateMount = previewFrames.mount({ root: lateRoot, element: frame });
    expect(lateRoot.childElementCount).toBe(0);
    expect(getPreview).toHaveBeenCalledTimes(2);
    resolveRefresh([undefined, readyResult]);
    await expect(reopening).rejects.toThrow("canvas is stopping");
    await stopping;
    expect(closePreview).toHaveBeenCalledWith({
      draftId: "Remounted",
      previewId: "remounted-owner-old",
      expectedRevision: summary.revision,
    });
    expect(closePreview).toHaveBeenCalledWith({
      draftId: "Remounted",
      previewId: "remounted-owner-new",
      expectedRevision: summary.revision,
    });

    cleanupLateMount?.();
    cleanupRemount?.();
    await runtime.shutdown();
  });

  it("places a root Preview frame beside the world bounds of a transformed grouped chat", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const parent: TGroup = {
      id: "chat-group",
      parentGroupId: null,
      zIndex: "a0",
      locked: false,
      createdAt: 1,
    };
    const origin: TElement = {
      id: "grouped-chat-origin",
      x: 35,
      y: 45,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: parent.id,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "unregistered-chat-origin",
        w: 420,
        h: 480,
        expanded: true,
        window: "contained",
        payload: {},
      },
      style: {},
    };
    const docHandle = createMockDocHandle({
      elements: { [origin.id]: origin },
      groups: { [parent.id]: parent },
    });
    const getDraft = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, {
      draftId,
      name: draftId,
      displayName: draftId,
      revision: "revision-grouped",
    }] as const);
    const previewFailure = {
      ready: false as const,
      draftId: "Grouped",
      revision: "revision-grouped",
      currentRevision: "revision-grouped",
      reason: "validation-failed" as const,
      message: "Fix validation errors before Preview can run.",
      diagnostics: [],
    };
    const closePreview = vi.fn(async () => [undefined, { closed: false }] as const);
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgetDraft: { get: getDraft },
            widgetPreview: {
              get: vi.fn(async () => [undefined, {
                ...previewFailure,
                reason: "not-built",
                message: "Preview has not been built.",
              }] as const),
              build: vi.fn(async () => [undefined, previewFailure] as const),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: {} },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: {
        ...createTestWidgetBrowser(),
        createId: () => "grouped-preview-owner",
      },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "grouped-preview-placement-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    const layer = runtime.services.require("scene").staticForegroundLayer;
    const parentNode = layer.findOne(`#${parent.id}`);
    const originNode = layer.findOne(`#${origin.id}`);
    expect(parentNode).not.toBeNull();
    expect(originNode).not.toBeNull();
    parentNode!.setAttrs({
      x: 90,
      y: -35,
      rotation: 17,
      scaleX: 1.35,
      scaleY: 0.8,
    });
    const worldBounds = originNode!.getClientRect({
      relativeTo: layer,
      skipShadow: true,
      skipStroke: true,
    });

    const previewFrames = (runtime.services as unknown as { require(name: string): unknown }).require("draft-preview-frame") as DraftPreviewFrameService;
    await previewFrames.open({ draftName: "Grouped", originChatElementId: origin.id });

    const preview = docHandle.doc().elements[fnDraftPreviewElementId("Grouped")];
    expect(preview).toBeDefined();
    expect(preview.parentGroupId).toBeNull();
    expect(preview.x).toBeCloseTo(worldBounds.x + worldBounds.width + DRAFT_PREVIEW_FRAME_GAP);
    expect(preview.y).toBeCloseTo(worldBounds.y);
    expect(preview.x).not.toBe(origin.x + origin.data.w + DRAFT_PREVIEW_FRAME_GAP);

    await runtime.shutdown();
    expect(closePreview).toHaveBeenCalledOnce();
    expect(closePreview).toHaveBeenCalledWith({
      draftId: "Grouped",
      previewId: "grouped-preview-owner",
      expectedRevision: "revision-grouped",
    });
  });

  it("drains a delayed build on stop, releases its ready result, and never creates a frame", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const origin: TElement = {
      id: "delayed-chat-origin",
      x: 140,
      y: 90,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "unregistered-chat-origin",
        w: 420,
        h: 480,
        expanded: true,
        window: "contained",
        payload: {},
      },
      style: {},
    };
    const docHandle = createMockDocHandle({ elements: { [origin.id]: origin } });
    const readyResult = {
      ready: true as const,
      draftId: "Delayed",
      name: "Delayed",
      revision: "revision-delayed",
      currentRevision: "revision-delayed",
      stale: false,
      sources: { "widget/main.ts": "export default {}" },
      snapshot: { state: "idle", context: {} },
    };
    let resolveBuild!: (value: readonly [undefined, typeof readyResult]) => void;
    const buildPreview = vi.fn(() => new Promise<readonly [undefined, typeof readyResult]>((resolve) => {
      resolveBuild = resolve;
    }));
    const getDraft = vi.fn(async () => [undefined, {
      draftId: "Delayed",
      name: "Delayed",
      displayName: "Delayed",
      revision: "revision-delayed",
    }] as const);
    const closePreview = vi.fn(async () => [undefined, {
      closed: true,
      draftId: "Delayed",
      previewId: "delayed-preview-frame",
      revision: "revision-delayed",
    }] as const);
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgetDraft: { get: getDraft },
            widgetPreview: {
              get: vi.fn(async () => [undefined, {
                ready: false,
                draftId: "Delayed",
                revision: "revision-delayed",
                currentRevision: "revision-delayed",
                reason: "not-built",
                message: "Preview has not been built.",
                diagnostics: [],
              }] as const),
              build: buildPreview,
              refresh: vi.fn(),
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: {} },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: {
        ...createTestWidgetBrowser(),
        createId: () => "delayed-preview-owner",
      },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "delayed-preview-shutdown-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    const previewFrames = (runtime.services as unknown as { require(name: string): unknown }).require("draft-preview-frame") as DraftPreviewFrameService;
    const opening = previewFrames.open({ draftName: "Delayed", originChatElementId: origin.id });
    await vi.waitFor(() => expect(buildPreview).toHaveBeenCalledOnce());

    const stopping = previewFrames.stop();
    resolveBuild([undefined, readyResult]);
    await expect(opening).rejects.toThrow("canvas is stopping");
    await stopping;

    expect(Object.values(docHandle.doc().elements)).toEqual([origin]);
    expect(closePreview).toHaveBeenCalledOnce();
    expect(closePreview).toHaveBeenCalledWith({
      draftId: "Delayed",
      previewId: "delayed-preview-owner",
      expectedRevision: "revision-delayed",
    });
    await expect(previewFrames.open({ draftName: "Delayed", originChatElementId: origin.id })).rejects.toThrow("canvas is stopping");
    expect(getDraft).toHaveBeenCalledOnce();

    await runtime.shutdown();
    expect(closePreview).toHaveBeenCalledOnce();
  });

  it("does not create a frame when the draft disappears before or during build and hydrates a persisted stale frame", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const origin: TElement = {
      id: "chat-origin",
      x: 40,
      y: 80,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "unregistered-chat-origin",
        w: 420,
        h: 480,
        expanded: true,
        window: "contained",
        payload: {},
      },
      style: {},
    };
    const previewElement: TElement = {
      id: "persisted-preview",
      x: 500,
      y: 80,
      rotation: 0,
      zIndex: "a1",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: DRAFT_PREVIEW_WIDGET_KIND,
        w: 420,
        h: 480,
        expanded: true,
        window: "contained",
        payload: {
          draftId: "Weather",
          pinnedRevision: "revision-old",
          originChatElementId: "chat-origin",
        },
      },
      style: {},
    };
    const docHandle = createMockDocHandle({
      elements: {
        [origin.id]: origin,
        [previewElement.id]: previewElement,
      },
    });
    const getDraft = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, draftId === "Missing" ? null : {
      draftId,
      name: draftId,
      displayName: draftId,
      revision: "revision-new",
    }] as const);
    const buildPreview = vi.fn(async ({ draftId }: { draftId: string }) => [undefined, {
      ready: false,
      draftId,
      currentRevision: "revision-new",
      reason: "not-found",
      message: `Widget draft '${draftId}' was not found.`,
      diagnostics: [],
    }] as const);
    const closePreview = vi.fn(async () => [undefined, { closed: false }] as const);
    let generatedPreviewId = 0;
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgetDraft: { get: getDraft },
            widgetPreview: {
              get: async ({ draftId }: { draftId: string }) => [undefined, {
                ready: false,
                draftId,
                revision: "revision-old",
                currentRevision: "revision-new",
                reason: "not-built",
                message: "Preview has not been built.",
                diagnostics: [],
              }],
              build: buildPreview,
              refresh: vi.fn(),
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: {} },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: {
        ...createTestWidgetBrowser(),
        createId: () => `hydrated-preview-${++generatedPreviewId}`,
      },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "preview-hydration-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    await vi.waitFor(() => expect(container?.textContent).toContain("persisted Preview revision is no longer built"));
    expect(Object.values(docHandle.doc().elements)).toHaveLength(2);
    expect(buildPreview).not.toHaveBeenCalled();

    const previewFrames = (runtime.services as unknown as { require(name: string): unknown }).require("draft-preview-frame") as DraftPreviewFrameService;
    await expect(previewFrames.open({ draftName: "Missing", originChatElementId: origin.id })).rejects.toThrow("was not found");
    await expect(previewFrames.open({ draftName: "RemovedDuringBuild", originChatElementId: origin.id })).rejects.toThrow("was not found");
    expect(buildPreview).toHaveBeenCalledOnce();
    expect(buildPreview).toHaveBeenCalledWith({
      draftId: "RemovedDuringBuild",
      previewId: expect.stringMatching(/^hydrated-preview-/),
      expectedRevision: "revision-new",
    });
    expect(Object.values(docHandle.doc().elements)).toHaveLength(2);

    await runtime.shutdown();
  });

  it("opens a Preview only when the mounted AI Chat action is clicked", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const origin: TElement = {
      id: "mounted-ai-chat",
      x: 80,
      y: 60,
      rotation: 0,
      zIndex: "a0",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: 1,
      updatedAt: 1,
      data: {
        type: "ui-widget",
        kind: "ai",
        w: 400,
        h: 460,
        expanded: true,
        window: "contained",
        payload: { sessionId: "session-widget-create-history" },
      },
      style: {},
    };
    const docHandle = createMockDocHandle({ elements: { [origin.id]: origin } });
    const getDraft = vi.fn(async () => [undefined, {
      draftId: "Shared Timer",
      name: "Shared Timer",
      displayName: "Shared Timer",
      revision: "revision-shared-timer",
    }] as const);
    const buildPreview = vi.fn(async () => [undefined, {
      ready: false,
      draftId: "Shared Timer",
      revision: "revision-shared-timer",
      currentRevision: "revision-shared-timer",
      reason: "validation-failed",
      message: "Fix validation before Preview can run.",
      diagnostics: ["widget/main.ts: invalid"],
    }] as const);
    const closePreview = vi.fn(async () => [undefined, {
      closed: false,
      draftId: "Shared Timer",
      previewId: "mounted-preview-frame",
      revision: "revision-shared-timer",
    }] as const);
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            approval: { list: async () => [undefined, []] },
            settings: {
              get: async () => [undefined, {
                defaultThinkingLevel: "minimal",
                models: [],
                providers: [],
                providersWithCredentials: [],
              }],
            },
            chat: {
              connect: async () => [undefined, {
                editSession: null,
                messageHistory: [{
                  role: "toolResult",
                  toolCallId: "call-widget-create",
                  toolName: "vc_widget_create",
                  content: [{ type: "text", text: "Created Shared Timer." }],
                  details: { name: "Shared Timer", source: "draft", draft: true },
                }],
                vcJson: null,
              }],
            },
            widgetDraft: { get: getDraft },
            widgetPreview: {
              get: async ({ draftId }: { draftId: string }) => [undefined, {
                ready: false,
                draftId,
                revision: "revision-shared-timer",
                currentRevision: "revision-shared-timer",
                reason: "not-built",
                message: "Preview has not been built.",
                diagnostics: [],
              }],
              build: buildPreview,
              refresh: vi.fn(),
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          resource: { resources: { list: async () => [undefined, []] } },
        },
      } as never,
      widgetTransport: {
        api: {
          actors: {
            definitions: { list: vi.fn(async () => [undefined, []]), get: vi.fn() },
            instances: {} as never,
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      chatBrowser: createTestChatBrowser(),
      widgetBrowser: {
        ...createTestWidgetBrowser(),
        createId: () => "mounted-preview-owner",
      },
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "mounted-chat-preview-action-test",
      tenant: LOCAL_BROWSER_TENANT_SCOPE,
      container,
      docHandle,
      onToggleSidebar: () => {},
      env: { DEV: false },
      themeService: new ThemeService(),
      image: {
        uploadImage: async () => ({ url: "memory://uploaded" }),
        cloneImage: async () => ({ url: "memory://cloned" }),
        deleteImage: async () => ({ ok: true }),
      },
    }, [extension]);

    await runtime.boot();
    const action = await vi.waitFor(() => {
      const button = container?.querySelector<HTMLButtonElement>(".ai-chat-history__preview-action button");
      expect(button).not.toBeNull();
      return button!;
    });

    expect(Object.values(docHandle.doc().elements)).toHaveLength(1);
    expect(getDraft).not.toHaveBeenCalled();
    expect(buildPreview).not.toHaveBeenCalled();

    action.click();

    await vi.waitFor(() => expect(Object.values(docHandle.doc().elements)).toHaveLength(2));
    expect(getDraft).toHaveBeenCalledOnce();
    expect(buildPreview).toHaveBeenCalledWith({
      draftId: "Shared Timer",
      previewId: "mounted-preview-owner",
      expectedRevision: "revision-shared-timer",
    });
    expect(docHandle.doc().elements[fnDraftPreviewElementId("Shared Timer")]?.data).toMatchObject({
      type: "ui-widget",
      kind: DRAFT_PREVIEW_WIDGET_KIND,
      payload: {
        draftId: "Shared Timer",
        pinnedRevision: "revision-shared-timer",
        originChatElementId: origin.id,
      },
    });

    await runtime.shutdown();
  });
});
