import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import { afterEach, describe, expect, test, vi } from "vitest"
import { getDraftPreviewPayload } from "../../src/draft-preview/DraftPreviewFrameService"
import { DRAFT_PREVIEW_WIDGET_KIND } from "../../src/draft-preview/CONSTANTS"
import { mountDraftPreview } from "../../src/draft-preview/mount"
import type { TDraftPreviewReady } from "../../src/draft-preview/typed"
import type { TWidgetBrowserPort } from "../../src/ports"
import type {
  TWidgetFunctionHostBridge,
  TWidgetUiArtifactMountPort,
} from "../../src/widget-runtime/interface"

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"
const DEFINITION_ID = "20000000-0000-4000-8000-000000000001"
const REVISION_ONE = "a".repeat(64)
const REVISION_TWO = "b".repeat(64)

let root: HTMLDivElement | undefined

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function uiArtifact(source: string) {
  const outputBytes = Buffer.from(source, "utf8")
  const envelopeBytes = Buffer.from(JSON.stringify({
    format: "vibecanvas.widget-artifact.v1",
    kind: "ui",
    entry: "ui/main.ts",
    sourceDigestSha256: "c".repeat(64),
    builderIdentity: "stateless-preview-test",
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

function ready(revision: string): TDraftPreviewReady {
  return {
    ready: true,
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    name: "Weather",
    revision,
    manifest: {
      schemaVersion: 2,
      name: "Weather",
      slug: "weather",
      ui: { entry: "ui/main.ts" },
    },
    uiArtifact: uiArtifact(`export default '${revision}';`),
    contract: { digestSha256: "d".repeat(64), functions: [] },
    diagnostics: [],
  }
}

function browser(): TWidgetBrowserPort {
  let id = 0
  return {
    document,
    createId: () => `preview-call-${++id}`,
    organizationId: () => "org-1",
    tenantAuthorityKey: () => "authority-1",
    now: () => 1,
    nowDate: () => new Date(1),
    setTimeout: (callback, timeout) => window.setTimeout(callback, timeout),
    clearTimeout: (timer) => window.clearTimeout(timer as number),
    setInterval: (callback, timeout) => window.setInterval(callback, timeout),
    clearInterval: (timer) => window.clearInterval(timer as number),
    decodeBase64: (value) => Buffer.from(value, "base64"),
    decodeUtf8: (value) => Buffer.from(value).toString("utf8"),
    digestSha256: async (value) => digest(value),
  }
}

afterEach(() => {
  root?.remove()
  root = undefined
})

describe("stateless Draft Preview", () => {
  test("rebuilds the current draft and exposes no durable Preview identity", async () => {
    root = document.createElement("div")
    document.body.append(root)
    const build = vi.fn()
      .mockResolvedValueOnce([undefined, ready(REVISION_ONE)])
      .mockResolvedValueOnce([undefined, ready(REVISION_TWO)])
    const bridges: TWidgetFunctionHostBridge[] = []
    const mountArtifact: TWidgetUiArtifactMountPort = {
      mount: vi.fn((args) => {
        bridges.push(args.functionBridge)
        return () => undefined
      }),
    }
    const runtime = mountDraftPreview({
      root,
      api: { api: { agent: { widgetPreview: { build } } } } as never,
      browser: browser(),
      payload: { draftId: DRAFT_ID, draftName: "Weather" },
      mountArtifact,
      onLogError: vi.fn(),
    })

    await vi.waitFor(() => expect(mountArtifact.mount).toHaveBeenCalledTimes(1))
    expect(build).toHaveBeenCalledWith({ draftId: DRAFT_ID })
    expect(bridges[0]?.identity).toEqual({
      kind: "draft_preview",
      draftId: DRAFT_ID,
      definitionId: DEFINITION_ID,
      revision: REVISION_ONE,
    })
    await expect(bridges[0]!.invoke({
      functionName: "loadWeather",
      input: {},
      idempotencyKey: "preview-call-1",
    })).rejects.toMatchObject({
      code: "PREVIEW_FUNCTIONS_UNAVAILABLE",
    })

    await runtime.refresh()
    expect(mountArtifact.mount).toHaveBeenCalledTimes(2)
    expect(runtime.getCurrentRevision()).toBe(REVISION_TWO)
    expect(build).toHaveBeenLastCalledWith({ draftId: DRAFT_ID })
    await runtime.dispose()
    expect(root.childElementCount).toBe(0)
  })

  test("persists only draft identity in the canvas payload", () => {
    const payload = getDraftPreviewPayload({
      data: {
        type: "ui-widget",
        kind: DRAFT_PREVIEW_WIDGET_KIND,
        w: 480,
        h: 320,
        expanded: true,
        window: "contained",
        payload: { draftId: DRAFT_ID, draftName: "Weather", originChatElementId: "chat-1" },
      },
    } as never)
    expect(payload).toEqual({
      draftId: DRAFT_ID,
      draftName: "Weather",
      originChatElementId: "chat-1",
    })
  })
})
