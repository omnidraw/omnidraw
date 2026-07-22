import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { LOCAL_BROWSER_TENANT_SCOPE } from "@vibecanvas/canvas/CONSTANTS"
import { buildRuntime } from "@vibecanvas/canvas/runtime"
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types"
import { ThemeService } from "@vibecanvas/service-theme"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createAiChatCanvasExtension } from "../../src/canvas-extension"
import { DRAFT_PREVIEW_FRAME_GAP, DRAFT_PREVIEW_WIDGET_KIND } from "../../src/draft-preview/CONSTANTS"
import type { DraftPreviewFrameService } from "../../src/draft-preview/DraftPreviewFrameService"
import { fnDraftPreviewElementId } from "../../src/draft-preview/fn.element-id"
import {
  createMockDocHandle,
  createTestApplication,
  createTestChatBrowser,
  createTestContainer,
  createTestWidgetBrowser,
  ensureCanvasDom,
} from "../test-setup"

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"
const DEFINITION_ID = "20000000-0000-4000-8000-000000000001"
const CHAT_ID = "30000000-0000-4000-8000-000000000001"
const PREVIEW_ID = "00000000-0000-4000-8000-000000000001"
const PREVIEW_REVISION_ONE = "40000000-0000-4000-8000-000000000001"
const PREVIEW_REVISION_TWO = "40000000-0000-4000-8000-000000000002"
const DRAFT_REVISION = "a".repeat(64)

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function uiArtifact() {
  const outputBytes = Buffer.from("export default 'preview';", "utf8")
  const envelopeBytes = Buffer.from(JSON.stringify({
    format: "vibecanvas.widget-artifact.v1",
    kind: "ui",
    entry: "ui/main.ts",
    sourceDigestSha256: "c".repeat(64),
    builderIdentity: "extension-integration-test",
    runtimeAbi: null,
    outputs: [{
      path: "output-0.js",
      loader: "js",
      kind: "entry-point",
      digestSha256: digest(outputBytes),
      bytesBase64: outputBytes.toString("base64"),
    }],
  }), "utf8")
  return {
    digestSha256: digest(envelopeBytes),
    byteSize: envelopeBytes.byteLength,
    bytesBase64: envelopeBytes.toString("base64"),
  }
}

function summary() {
  return {
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    chatId: CHAT_ID,
    name: "Weather",
    displayName: "Weather",
    state: "modified" as const,
    revision: DRAFT_REVISION,
    publishedRevisionId: null,
    updatedAt: new Date(1).toISOString(),
    validation: { status: "valid" as const, errors: [], warnings: [], validatedRevision: DRAFT_REVISION },
    previewAvailable: true,
    publishReady: true,
  }
}

function ready(previewId: string, previewRevisionId: string) {
  return {
    ready: true as const,
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    name: "Weather",
    previewId,
    previewRevisionId,
    revision: DRAFT_REVISION,
    currentRevision: DRAFT_REVISION,
    stale: false,
    manifest: {
      schemaVersion: 2 as const,
      name: "Weather",
      slug: "weather",
      ui: { entry: "ui/main.ts" },
    },
    uiArtifact: uiArtifact(),
    contract: { digestSha256: "d".repeat(64), functions: [] },
    diagnostics: [],
    expiresAtMs: 10_000,
  }
}

function origin(id = "chat-origin"): TElement {
  return {
    id,
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
  }
}

function extension(chatApi: unknown) {
  return createAiChatCanvasExtension({
    chatApi: chatApi as never,
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
  })
}

function runtimeArgs(container: HTMLDivElement, docHandle: ReturnType<typeof createMockDocHandle>) {
  return {
    canvasId: "preview-extension-test",
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
  }
}

describe("AI Chat canvas extension", () => {
  let container: HTMLDivElement | undefined

  afterEach(() => {
    container?.remove()
    container = undefined
  })

  test("registers canvas capabilities before hydration and tears down its portal", async () => {
    ensureCanvasDom()
    container = createTestContainer()
    const current = buildRuntime(
      runtimeArgs(container, createMockDocHandle()),
      [extension({})],
    )

    await current.boot()
    expect(current.services.require("tool").getTool("ai")?.label).toBe("AI Chat")
    expect(container.querySelector("#widget-portal")).not.toBeNull()

    await current.shutdown()
    expect(current.services.require("tool").getTool("ai")).toBeUndefined()
    expect(container.querySelector("#widget-portal")).toBeNull()
  })

  test("persists one immutable Preview per draft, refreshes by CAS, and closes the exact active revision", async () => {
    ensureCanvasDom()
    container = createTestContainer()
    const chatOrigin = origin()
    const docHandle = createMockDocHandle({ elements: { [chatOrigin.id]: chatOrigin } })
    const elementId = fnDraftPreviewElementId(DRAFT_ID)
    const previewId = PREVIEW_ID
    const listDrafts = vi.fn(async () => [undefined, [summary()]] as const)
    const getDraft = vi.fn(async () => [undefined, summary()] as const)
    const getPreview = vi.fn(async () => [undefined, {
      ready: false as const,
      draftId: DRAFT_ID,
      previewId,
      reason: "not-built" as const,
      message: "Preview has not been built.",
      diagnostics: [],
    }] as const)
    const buildPreview = vi.fn()
      .mockResolvedValueOnce([undefined, ready(previewId, PREVIEW_REVISION_ONE)])
      .mockResolvedValueOnce([undefined, ready(previewId, PREVIEW_REVISION_TWO)])
    const closePreview = vi.fn(async ({
      draftId,
      previewId: owner,
      expectedPreviewRevisionId,
    }: {
      draftId: string
      previewId: string
      expectedPreviewRevisionId: string
    }) => [undefined, {
      closed: true,
      draftId,
      previewId: owner,
      previewRevisionId: expectedPreviewRevisionId,
    }] as const)
    const current = buildRuntime(runtimeArgs(container, docHandle), [extension({
      api: {
        agent: {
          widgetDraft: { list: listDrafts, get: getDraft },
          widgetPreview: {
            get: getPreview,
            build: buildPreview,
            close: closePreview,
            invoke: vi.fn(),
            invocation: { get: vi.fn(), cancel: vi.fn() },
          },
          events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
        },
        resource: { resources: {} },
      },
    })])

    await current.boot()
    const previewFrames = (current.services as unknown as { require(name: string): unknown })
      .require("draft-preview-frame") as DraftPreviewFrameService
    await previewFrames.open({ draftName: "Weather", originChatElementId: chatOrigin.id })

    expect(listDrafts).toHaveBeenCalledWith({})
    expect(getDraft).toHaveBeenCalledWith({ draftId: DRAFT_ID })
    const first = docHandle.doc().elements[elementId]
    expect(first).toBeDefined()
    expect(first?.x).toBe(chatOrigin.x + chatOrigin.data.w + DRAFT_PREVIEW_FRAME_GAP)
    expect(first?.y).toBe(chatOrigin.y)
    expect(first?.data.type === "ui-widget" ? first.data.payload : null).toEqual({
      draftId: DRAFT_ID,
      draftName: "Weather",
      draftRevision: DRAFT_REVISION,
      previewId,
      previewRevisionId: PREVIEW_REVISION_ONE,
      originChatElementId: chatOrigin.id,
    })
    expect(current.services.require("selection").focusedId).toBe(elementId)

    await previewFrames.open({ draftId: DRAFT_ID, draftName: "Weather", originChatElementId: chatOrigin.id })
    expect(listDrafts).toHaveBeenCalledTimes(1)
    expect(Object.values(docHandle.doc().elements).filter((element) => (
      element.data.type === "ui-widget" && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND
    ))).toHaveLength(1)
    expect(buildPreview).toHaveBeenNthCalledWith(2, {
      draftId: DRAFT_ID,
      previewId,
      expectedDraftRevision: DRAFT_REVISION,
      expectedActivePreviewRevisionId: PREVIEW_REVISION_ONE,
    })
    expect(first?.data.type === "ui-widget" ? first.data.payload?.previewRevisionId : null)
      .toBe(PREVIEW_REVISION_TWO)

    await current.shutdown()
    expect(closePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId,
      expectedPreviewRevisionId: PREVIEW_REVISION_TWO,
    })
  })

  test("drains a late build on stop and releases only its exact immutable revision", async () => {
    ensureCanvasDom()
    container = createTestContainer()
    const chatOrigin = origin("late-chat-origin")
    const docHandle = createMockDocHandle({ elements: { [chatOrigin.id]: chatOrigin } })
    const elementId = fnDraftPreviewElementId(DRAFT_ID)
    const previewId = PREVIEW_ID
    let resolveBuild!: (value: readonly [undefined, ReturnType<typeof ready>]) => void
    const buildPreview = vi.fn(() => new Promise<readonly [undefined, ReturnType<typeof ready>]>((resolve) => {
      resolveBuild = resolve
    }))
    const closePreview = vi.fn(async () => [undefined, {
      closed: true,
      draftId: DRAFT_ID,
      previewId,
      previewRevisionId: PREVIEW_REVISION_ONE,
    }] as const)
    const current = buildRuntime(runtimeArgs(container, docHandle), [extension({
      api: {
        agent: {
          widgetDraft: { get: vi.fn(async () => [undefined, summary()] as const) },
          widgetPreview: {
            get: vi.fn(async () => [undefined, {
              ready: false,
              draftId: DRAFT_ID,
              previewId,
              reason: "not-built",
              message: "Preview has not been built.",
              diagnostics: [],
            }] as const),
            build: buildPreview,
            close: closePreview,
            invoke: vi.fn(),
            invocation: { get: vi.fn(), cancel: vi.fn() },
          },
          events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
        },
        resource: { resources: {} },
      },
    })])
    await current.boot()
    const previewFrames = (current.services as unknown as { require(name: string): unknown })
      .require("draft-preview-frame") as DraftPreviewFrameService
    const opening = previewFrames.open({ draftId: DRAFT_ID, draftName: "Weather", originChatElementId: chatOrigin.id })
    await vi.waitFor(() => expect(buildPreview).toHaveBeenCalledOnce())
    const stopping = previewFrames.stop()
    resolveBuild([undefined, ready(previewId, PREVIEW_REVISION_ONE)])

    await expect(opening).rejects.toThrow("canvas is stopping")
    await stopping
    expect(docHandle.doc().elements[elementId]).toBeUndefined()
    expect(closePreview).toHaveBeenCalledOnce()
    expect(closePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId,
      expectedPreviewRevisionId: PREVIEW_REVISION_ONE,
    })
    await current.shutdown()
  })

  test("hydrates a persisted exact Preview with a UUID owner distinct from its element identity", async () => {
    ensureCanvasDom()
    container = createTestContainer()
    const previewId = "00000000-0000-4000-8000-000000000002"
    const elementId = fnDraftPreviewElementId(DRAFT_ID)
    const persisted: TElement = {
      id: elementId,
      x: 500,
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
        kind: DRAFT_PREVIEW_WIDGET_KIND,
        w: 420,
        h: 480,
        expanded: true,
        window: "contained",
        payload: {
          draftId: DRAFT_ID,
          draftName: "Weather",
          draftRevision: DRAFT_REVISION,
          previewId,
          previewRevisionId: PREVIEW_REVISION_ONE,
        },
      },
      style: {},
    }
    const docHandle = createMockDocHandle({ elements: { [elementId]: persisted } })
    const getPreview = vi.fn(async () => [undefined, ready(previewId, PREVIEW_REVISION_ONE)] as const)
    const buildPreview = vi.fn()
    const closePreview = vi.fn(async () => [undefined, {
      closed: true,
      draftId: DRAFT_ID,
      previewId,
      previewRevisionId: PREVIEW_REVISION_ONE,
    }] as const)
    const current = buildRuntime(runtimeArgs(container, docHandle), [extension({
      api: {
        agent: {
          widgetDraft: { get: vi.fn(async () => [undefined, summary()] as const) },
          widgetPreview: {
            get: getPreview,
            build: buildPreview,
            close: closePreview,
            invoke: vi.fn(),
            invocation: { get: vi.fn(), cancel: vi.fn() },
          },
          events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
        },
        resource: { resources: {} },
      },
    })])

    await current.boot()
    await vi.waitFor(() => expect(getPreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId,
    }))
    expect(buildPreview).not.toHaveBeenCalled()
    await current.shutdown()
    expect(closePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId,
      expectedPreviewRevisionId: PREVIEW_REVISION_ONE,
    })
  })
})
