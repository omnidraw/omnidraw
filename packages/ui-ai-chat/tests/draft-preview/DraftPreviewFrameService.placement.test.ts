import { ThemeService } from "@vibecanvas/service-theme";
import { buildRuntime } from "@vibecanvas/canvas/runtime";
import { LOCAL_BROWSER_TENANT_SCOPE } from "@vibecanvas/canvas/CONSTANTS";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAiChatCanvasExtension } from "../../src/canvas-extension";
import { DRAFT_PREVIEW_WIDGET_KIND } from "../../src/draft-preview/CONSTANTS";
import type { DraftPreviewFrameService } from "../../src/draft-preview/DraftPreviewFrameService";
import { fnDraftPreviewElementId } from "../../src/draft-preview/fn.element-id";
import {
  createMockDocHandle,
  createTestApplication,
  createTestChatBrowser,
  createTestContainer,
  createTestWidgetBrowser,
  ensureCanvasDom,
} from "../test-setup";

describe("DraftPreviewFrameService placement", () => {
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    container?.remove();
    container = undefined;
  });

  test("places multiple independent frames for the same draft revision", async () => {
    ensureCanvasDom();
    container = createTestContainer();
    const docHandle = createMockDocHandle();
    const summary = {
      draftId: "Blobby",
      name: "Blobby",
      displayName: "Blobby",
      revision: "revision-blobby",
    };
    const ready = {
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
    const resolvePreviewGets: Array<(value: readonly [undefined, typeof ready]) => void> = [];
    const getPreview = vi.fn(() => new Promise<readonly [undefined, typeof ready]>((resolve) => {
      resolvePreviewGets.push(resolve);
    }));
    const closePreview = vi.fn(async ({ draftId, expectedRevision }: { draftId: string; expectedRevision: string }) => [undefined, {
      closed: true,
      draftId,
      revision: expectedRevision,
    }] as const);
    const refreshPreview = vi.fn(async () => [undefined, ready] as const);
    const resetPreview = vi.fn(async () => [undefined, ready] as const);
    const publish = vi.fn(async () => [undefined, {
      published: true,
      draftId: summary.draftId,
      revision: summary.revision,
      definitionName: summary.name,
      manifest: {},
    }] as const);
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgets: { detail: vi.fn(async () => [undefined, {
              name: summary.name,
              source: "draft",
              relation: "draft-only",
              sibling: null,
              manifest: null,
              problem: null,
              variant: {
                source: "draft",
                displayName: summary.displayName,
                kind: "actor-widget",
                slug: "blobby",
                description: null,
                revision: summary.revision,
                contentFingerprint: null,
                updatedAt: null,
                tool: { label: summary.displayName, icon: null, group: null, priority: null, behaviorType: "mode" },
                validation: null,
              },
            }] as const) },
            widgetPublish: { publish },
            widgetDraft: { get: vi.fn(async () => [undefined, summary] as const) },
            widgetPreview: {
              get: getPreview,
              build: vi.fn(),
              refresh: refreshPreview,
              reset: resetPreview,
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
          actors: { resources: {} },
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
      widgetBrowser: createTestWidgetBrowser(),
      application: createTestApplication(),
    });
    const runtime = buildRuntime({
      canvasId: "multi-preview-placement-test",
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
    const previewFrames = (runtime.services as unknown as { require(name: string): unknown })
      .require("draft-preview-frame") as DraftPreviewFrameService;
    await previewFrames.place({
      draftName: summary.draftId,
      expectedRevision: summary.revision,
      previewId: "preview-owner-1",
      bounds: { x: 100, y: 120, width: 360, height: 320 },
    });
    expect(getPreview).toHaveBeenCalledOnce();
    expect(docHandle.doc().elements[fnDraftPreviewElementId(summary.draftId, "preview-owner-1")]).toBeDefined();
    await previewFrames.place({
      draftName: summary.draftId,
      expectedRevision: summary.revision,
      previewId: "preview-owner-2",
      bounds: { x: 520, y: 120, width: 360, height: 320 },
    });

    const frames = Object.values(docHandle.doc().elements).filter((element) => (
      element.data.type === "ui-widget"
      && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND
      && element.data.payload?.draftId === summary.draftId
    ));
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.id)).toEqual([
      fnDraftPreviewElementId(summary.draftId, "preview-owner-1"),
      fnDraftPreviewElementId(summary.draftId, "preview-owner-2"),
    ]);
    expect(frames.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 100, y: 120 }, { x: 520, y: 120 }]);
    expect(getPreview).toHaveBeenCalledTimes(2);
    expect(runtime.services.require("selection").focusedId).toBe(frames[1]?.id);

    resolvePreviewGets.forEach((resolve) => resolve([undefined, ready]));
    const resetActions = await vi.waitFor(() => {
      const buttons = container!.querySelectorAll<HTMLButtonElement>("[data-widget-title-action-id='reset']");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      expect(buttons[0]!.disabled).toBe(false);
      return buttons;
    });
    expect(container!.querySelector(".vc-draft-preview__status")).toBeNull();
    resetActions[0]!.click();
    await vi.waitFor(() => expect(resetPreview).toHaveBeenCalledWith({
      draftId: summary.draftId,
      previewId: "preview-owner-1",
      expectedRevision: summary.revision,
    }));
    const publishActions = await vi.waitFor(() => {
      const buttons = container!.querySelectorAll<HTMLButtonElement>("[data-widget-title-action-id='publish']");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      return buttons;
    });
    publishActions[0]!.click();
    const confirm = await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
        .find((candidate) => candidate.textContent === "Publish" && !candidate.disabled);
      expect(button).toBeDefined();
      return button!;
    });
    confirm.click();
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith({
      draftId: summary.draftId,
      expectedRevision: summary.revision,
    }));
    await vi.waitFor(() => expect(refreshPreview).toHaveBeenCalledWith({
      draftId: summary.draftId,
      previewId: "preview-owner-1",
      expectedRevision: summary.revision,
    }));
    expect(Object.values(docHandle.doc().elements)).toHaveLength(2);
    await runtime.shutdown();
  });
});
