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
  const artifactBytes = Buffer.from(source, "utf8")
  return {
    digestSha256: digest(artifactBytes),
    byteSize: artifactBytes.byteLength,
    bytesBase64: artifactBytes.toString("base64"),
    runtimeDescriptor: {
      format: "vibecanvas.capsule-runtime.v1" as const,
      capsuleArtifactHash: `sha256:${"c".repeat(64)}` as const,
      target: {
        runtimeAbi: "quickjs-release-sync-v1",
        domProfile: "dom-core-v2",
        featureProfiles: [],
      },
      budgets: {
        cpuMs: 100,
        memoryBytes: 32 * 1024 * 1024,
        domNodes: 2_000,
        handles: 4_000,
        messageBytes: 64 * 1024,
        streamBytes: 64 * 1024,
        assetBytes: 0,
        networkBytes: 0,
        gpuBytes: 0,
        lifecycleBytes: 256 * 1024,
      },
      capabilityRequests: [],
      channels: null,
      parkability: { parkable: false as const },
      signatureKeyIds: ["preview-key"],
    },
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
      schemaVersion: 3,
      name: "Weather",
      slug: "weather",
      ui: {
        runtime: "capsule",
        entry: "ui/main.ts",
        target: {
          runtimeAbi: "quickjs-release-sync-v1",
          domProfile: "dom-core-v2",
          featureProfiles: [],
        },
      },
    },
    uiArtifact: uiArtifact(`export default '${revision}';`),
    contract: {
      digestSha256: "d".repeat(64),
      functions: [],
      browserFunctionDescriptorsDigestSha256: "e".repeat(64),
    },
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
    const destroys: Array<ReturnType<typeof vi.fn>> = []
    const mountArtifact: TWidgetUiArtifactMountPort = {
      mount: vi.fn(async (args) => {
        bridges.push(args.functionBridge)
        const destroy = vi.fn(async () => undefined)
        destroys.push(destroy)
        return {
          ready: vi.fn(async () => undefined),
          setProps: vi.fn(),
          setTheme: vi.fn(),
          setViewport: vi.fn(),
          focus: vi.fn(),
          freeze: vi.fn(async () => undefined),
          resume: vi.fn(async () => undefined),
          diagnostics: vi.fn(() => ({} as never)),
          destroy,
        }
      }),
      destroy: vi.fn(async () => undefined),
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
    })).rejects.toMatchObject({
      code: "PREVIEW_FUNCTIONS_UNAVAILABLE",
    })

    await runtime.refresh()
    expect(mountArtifact.mount).toHaveBeenCalledTimes(2)
    expect(destroys[0]).toHaveBeenCalledWith("preview-replaced")
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
