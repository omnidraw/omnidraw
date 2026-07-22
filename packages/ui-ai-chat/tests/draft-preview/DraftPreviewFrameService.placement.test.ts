import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { LOCAL_BROWSER_TENANT_SCOPE } from "@vibecanvas/canvas/CONSTANTS"
import { buildRuntime } from "@vibecanvas/canvas/runtime"
import { ThemeService } from "@vibecanvas/service-theme"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createAiChatCanvasExtension } from "../../src/canvas-extension"
import { DRAFT_PREVIEW_WIDGET_KIND } from "../../src/draft-preview/CONSTANTS"
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
const PREVIEW_ID_ONE = "60000000-0000-4000-8000-000000000001"
const PREVIEW_ID_TWO = "60000000-0000-4000-8000-000000000002"
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
    builderIdentity: "placement-test",
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

function ready(previewId: string, previewRevisionId: string) {
  return {
    ready: true as const,
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    name: "Blobby",
    previewId,
    previewRevisionId,
    revision: DRAFT_REVISION,
    currentRevision: DRAFT_REVISION,
    stale: false,
    manifest: {
      schemaVersion: 2 as const,
      name: "Blobby",
      slug: "blobby",
      ui: { entry: "ui/main.ts" },
    },
    uiArtifact: uiArtifact(),
    contract: { digestSha256: "d".repeat(64), functions: [] },
    diagnostics: [],
    expiresAtMs: 10_000,
  }
}

describe("DraftPreviewFrameService placement", () => {
  let container: HTMLDivElement | undefined

  afterEach(() => {
    container?.remove()
    container = undefined
  })

  test("recovers a committed build after response loss, persists ownership, and closes exact revisions", async () => {
    ensureCanvasDom()
    container = createTestContainer()
    const docHandle = createMockDocHandle()
    const summary = {
      draftId: DRAFT_ID,
      definitionId: DEFINITION_ID,
      chatId: "50000000-0000-4000-8000-000000000001",
      name: "Blobby",
      displayName: "Blobby",
      state: "modified" as const,
      revision: DRAFT_REVISION,
      publishedRevisionId: null,
      updatedAt: new Date(1).toISOString(),
      validation: { status: "valid" as const, errors: [], warnings: [], validatedRevision: DRAFT_REVISION },
      previewAvailable: true,
      publishReady: true,
    }
    const previewRevisionByOwner = new Map([
      [PREVIEW_ID_ONE, "30000000-0000-4000-8000-000000000001"],
      [PREVIEW_ID_TWO, "30000000-0000-4000-8000-000000000002"],
    ])
    const getCallsByOwner = new Map<string, number>()
    const getPreview = vi.fn(async ({ previewId }: { previewId: string }) => {
      const call = (getCallsByOwner.get(previewId) ?? 0) + 1
      getCallsByOwner.set(previewId, call)
      if (previewId === PREVIEW_ID_ONE && call === 1) {
        return [undefined, {
          ready: false as const,
          draftId: DRAFT_ID,
          previewId,
          reason: "not-built" as const,
          message: "Preview has not been built.",
          diagnostics: [],
        }] as const
      }
      return [undefined, ready(previewId, previewRevisionByOwner.get(previewId)!)] as const
    })
    let lostFirstBuildResponse = false
    const buildPreview = vi.fn(async ({ previewId }: { previewId: string }) => {
      if (previewId === PREVIEW_ID_ONE && !lostFirstBuildResponse) {
        lostFirstBuildResponse = true
        return [{ message: "Preview response was lost after commit." }, undefined] as const
      }
      const nextRevision = "30000000-0000-4000-8000-000000000003"
      previewRevisionByOwner.set(previewId, nextRevision)
      return [undefined, ready(previewId, nextRevision)] as const
    })
    const closePreview = vi.fn(async ({
      draftId,
      previewId,
      expectedPreviewRevisionId,
    }: {
      draftId: string
      previewId: string
      expectedPreviewRevisionId: string
    }) => [undefined, {
      closed: true,
      draftId,
      previewId,
      previewRevisionId: expectedPreviewRevisionId,
    }] as const)
    const publish = vi.fn(async () => [undefined, {
      published: true as const,
      draftId: DRAFT_ID,
      definitionId: DEFINITION_ID,
      revision: DRAFT_REVISION,
      publishedRevisionId: "40000000-0000-4000-8000-000000000001",
      manifest: {
        schemaVersion: 2 as const,
        name: "Blobby",
        slug: "blobby",
        ui: { entry: "ui/main.ts" },
      },
    }] as const)
    const detail = vi.fn(async () => [undefined, {
      name: "Blobby",
      source: "draft" as const,
      relation: "draft-only" as const,
      sibling: null,
      manifest: {
        schemaVersion: 2 as const,
        name: "Blobby",
        slug: "blobby",
        ui: { entry: "ui/main.ts" },
      },
      problem: null,
      variant: {
        source: "draft" as const,
        draftId: DRAFT_ID,
        displayName: "Blobby",
        kind: "widget" as const,
        slug: "blobby",
        description: null,
        revision: DRAFT_REVISION,
        contentFingerprint: null,
        updatedAt: null,
        tool: { label: "Blobby", icon: null, group: null, priority: null, behaviorType: null },
        validation: summary.validation,
      },
    }] as const)
    const extension = createAiChatCanvasExtension({
      chatApi: {
        api: {
          agent: {
            widgets: { detail },
            widgetPublish: { publish },
            widgetDraft: { get: vi.fn(async () => [undefined, summary] as const) },
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
    })
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
    }, [extension])

    await runtime.boot()
    const previewFrames = (runtime.services as unknown as { require(name: string): unknown })
      .require("draft-preview-frame") as DraftPreviewFrameService
    await previewFrames.place({
      draftId: DRAFT_ID,
      expectedRevision: DRAFT_REVISION,
      previewId: PREVIEW_ID_ONE,
      bounds: { x: 100, y: 120, width: 360, height: 320 },
    })
    await previewFrames.place({
      draftId: DRAFT_ID,
      expectedRevision: DRAFT_REVISION,
      previewId: PREVIEW_ID_TWO,
      bounds: { x: 520, y: 120, width: 360, height: 320 },
    })

    const frames = Object.values(docHandle.doc().elements).filter((element) => (
      element.data.type === "ui-widget"
      && element.data.kind === DRAFT_PREVIEW_WIDGET_KIND
      && element.data.payload?.draftId === DRAFT_ID
    ))
    const elementIdOne = fnDraftPreviewElementId(DRAFT_ID, PREVIEW_ID_ONE)
    const elementIdTwo = fnDraftPreviewElementId(DRAFT_ID, PREVIEW_ID_TWO)
    expect(frames.map((frame) => frame.id)).toEqual([elementIdOne, elementIdTwo])
    expect(frames.map((frame) => frame.data.type === "ui-widget" ? frame.data.payload : null)).toEqual([
      {
        draftId: DRAFT_ID,
        draftName: "Blobby",
        draftRevision: DRAFT_REVISION,
        previewId: PREVIEW_ID_ONE,
        previewRevisionId: "30000000-0000-4000-8000-000000000001",
      },
      {
        draftId: DRAFT_ID,
        draftName: "Blobby",
        draftRevision: DRAFT_REVISION,
        previewId: PREVIEW_ID_TWO,
        previewRevisionId: "30000000-0000-4000-8000-000000000002",
      },
    ])
    expect(runtime.services.require("selection").focusedId).toBe(elementIdTwo)

    const resetActions = await vi.waitFor(() => {
      const buttons = container!.querySelectorAll<HTMLButtonElement>("[data-widget-title-action-id='reset']")
      expect(buttons).toHaveLength(2)
      expect(buttons[0]!.disabled).toBe(false)
      return buttons
    })
    resetActions[0]!.click()
    await Promise.resolve()
    expect(buildPreview).toHaveBeenCalledTimes(1)
    expect(closePreview).not.toHaveBeenCalled()

    const publishAction = container!.querySelectorAll<HTMLButtonElement>("[data-widget-title-action-id='publish']")[0]!
    publishAction.click()
    const confirm = await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
        .find((candidate) => candidate.textContent === "Publish" && !candidate.disabled)
      expect(button).toBeDefined()
      return button!
    })
    confirm.click()
    await vi.waitFor(() => expect(publish).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      expectedRevision: DRAFT_REVISION,
    }))
    await vi.waitFor(() => expect(buildPreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID_ONE,
      expectedDraftRevision: DRAFT_REVISION,
      expectedActivePreviewRevisionId: "30000000-0000-4000-8000-000000000001",
    }))
    expect(buildPreview).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(
      (docHandle.doc().elements[elementIdOne]?.data as { payload?: { previewRevisionId?: string } }).payload?.previewRevisionId,
    ).toBe("30000000-0000-4000-8000-000000000003"))

    await runtime.shutdown()
    expect(closePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID_ONE,
      expectedPreviewRevisionId: "30000000-0000-4000-8000-000000000003",
    })
    expect(closePreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID_TWO,
      expectedPreviewRevisionId: "30000000-0000-4000-8000-000000000002",
    })
  }, 20_000)
})
