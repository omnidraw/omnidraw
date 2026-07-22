import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import type { TWidgetBrowserFunctionDescriptor } from "@vibecanvas/widget-contract"
import { afterEach, describe, expect, test, vi } from "vitest"
import { createPreviewFunctionHostBridge } from "../../src/draft-preview/create-preview-function-host-bridge"
import { mountDraftPreview } from "../../src/draft-preview/mount"
import type { TDraftPreviewReady, TDraftPreviewSummary } from "../../src/draft-preview/typed"
import type { TWidgetBrowserPort } from "../../src/ports"
import type { TWidgetUiArtifactMountPort } from "../../src/widget-runtime/interface"

const DRAFT_ID = "10000000-0000-4000-8000-000000000001"
const DEFINITION_ID = "20000000-0000-4000-8000-000000000001"
const PREVIEW_ID = "00000000-0000-4000-8000-000000000001"
const PREVIEW_REVISION_ONE = "30000000-0000-4000-8000-000000000001"
const PREVIEW_REVISION_TWO = "30000000-0000-4000-8000-000000000002"
const DRAFT_REVISION_ONE = "a".repeat(64)
const DRAFT_REVISION_TWO = "b".repeat(64)

let root: HTMLDivElement | undefined

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function uiArtifact(source = "export default 'preview';") {
  const outputBytes = Buffer.from(source, "utf8")
  const envelopeBytes = Buffer.from(JSON.stringify({
    format: "vibecanvas.widget-artifact.v1",
    kind: "ui",
    entry: "ui/main.ts",
    sourceDigestSha256: "c".repeat(64),
    builderIdentity: "bun-browser-v1",
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

function functionDescriptor(exportName = "loadWeather"): TWidgetBrowserFunctionDescriptor {
  return {
    schemaVersion: 1,
    exportName,
    effect: "fx",
    inputSchema: {},
    outputSchema: {},
    resources: [],
    limits: {
      timeoutMs: 1_000,
      memoryTier: "small",
      outputByteLimit: 1_024,
      logByteLimit: 1_024,
    },
    retry: {
      mode: "none",
      maxAttempts: 1,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
    },
  }
}

function ready(args: Readonly<{
  draftRevision?: string
  previewRevisionId?: string
  functions?: readonly TWidgetBrowserFunctionDescriptor[]
  artifact?: ReturnType<typeof uiArtifact>
}> = {}): TDraftPreviewReady {
  const draftRevision = args.draftRevision ?? DRAFT_REVISION_ONE
  return {
    ready: true,
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    name: "Weather",
    previewId: PREVIEW_ID,
    previewRevisionId: args.previewRevisionId ?? PREVIEW_REVISION_ONE,
    revision: draftRevision,
    currentRevision: draftRevision,
    stale: false,
    manifest: {
      schemaVersion: 2,
      name: "Weather",
      slug: "weather",
      ui: { entry: "ui/main.ts" },
      ...(args.functions?.length ? { server: { entry: "server/main.ts" } } : {}),
    },
    uiArtifact: args.artifact ?? uiArtifact(),
    contract: {
      digestSha256: "d".repeat(64),
      functions: args.functions ?? [],
    },
    diagnostics: [],
    expiresAtMs: 10_000,
  }
}

function summary(revision = DRAFT_REVISION_TWO): TDraftPreviewSummary {
  return {
    draftId: DRAFT_ID,
    definitionId: DEFINITION_ID,
    name: "Weather",
    displayName: "Weather",
    revision,
  }
}

function browser(): TWidgetBrowserPort {
  let id = 0
  return {
    document,
    createId: () => `preview-key-${++id}`,
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

function createRoot() {
  root = document.createElement("div")
  document.body.appendChild(root)
  return root
}

function fixture(args: Readonly<{
  initial?: TDraftPreviewReady
  build?: ReturnType<typeof vi.fn>
  getPreview?: ReturnType<typeof vi.fn>
  invoke?: ReturnType<typeof vi.fn>
  getInvocation?: ReturnType<typeof vi.fn>
  cancelInvocation?: ReturnType<typeof vi.fn>
  mount?: ReturnType<typeof vi.fn>
}> = {}) {
  const initial = args.initial ?? ready()
  const build = args.build ?? vi.fn()
  const invoke = args.invoke ?? vi.fn()
  const getInvocation = args.getInvocation ?? vi.fn()
  const cancelInvocation = args.cancelInvocation ?? vi.fn(async () => [undefined, null] as const)
  const cleanup = vi.fn()
  const mount = args.mount ?? vi.fn(() => cleanup)
  const getPreview = args.getPreview ?? vi.fn()
  const getDraft = vi.fn()
  const close = vi.fn()
  const persist = vi.fn()
  const release = vi.fn()
  const logError = vi.fn()
  const resetState = vi.fn()
  const runtime = mountDraftPreview({
    root: createRoot(),
    api: {
      api: {
        agent: {
          widgetDraft: { get: getDraft },
          widgetPreview: {
            get: getPreview,
            build,
            close,
            invoke,
            invocation: { get: getInvocation, cancel: cancelInvocation },
          },
        },
      },
    } as never,
    browser: browser(),
    payload: {
      draftId: DRAFT_ID,
      draftName: "Weather",
      draftRevision: initial.revision,
      previewId: PREVIEW_ID,
      previewRevisionId: initial.previewRevisionId,
      originChatElementId: "chat-1",
    },
    initialResult: initial,
    mountArtifact: { mount } as TWidgetUiArtifactMountPort,
    onPersistOwnership: persist,
    onReleaseOwnership: release,
    onLogError: logError,
    onResetStateChange: resetState,
  })
  return {
    build,
    cancelInvocation,
    cleanup,
    close,
    getDraft,
    getInvocation,
    getPreview,
    initial,
    invoke,
    logError,
    mount,
    persist,
    release,
    resetState,
    runtime,
  }
}

afterEach(() => {
  root?.remove()
  root = undefined
})

describe("draft Preview artifact runtime", () => {
  test("verifies and mounts a UI-only artifact with Preview identity and ephemeral state", async () => {
    const current = fixture()
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    const mounted = current.mount.mock.calls[0]![0]
    expect(mounted.identity).toEqual({
      kind: "agent_preview",
      definitionId: DEFINITION_ID,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_ONE,
    })
    expect(mounted.artifact.digestSha256).toBe(current.initial.uiArtifact.digestSha256)
    expect(await mounted.collaborativeStateBridge.get()).toEqual({ version: 1, value: null })
    expect(current.getPreview).not.toHaveBeenCalled()
    expect(current.build).not.toHaveBeenCalled()

    await current.runtime.dispose()
    expect(current.release).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_ONE,
      previewRevisionId: PREVIEW_REVISION_ONE,
    })
  })

  test("rejects a mismatched UI artifact digest before mounting", async () => {
    const current = fixture({
      initial: ready({ artifact: { ...uiArtifact(), digestSha256: "0".repeat(64) } }),
    })

    await vi.waitFor(() => expect(root?.textContent).toContain("digest mismatch"))
    expect(current.mount).not.toHaveBeenCalled()
    expect(current.logError).toHaveBeenCalledWith(expect.objectContaining({
      message: "Widget UI artifact digest mismatch.",
    }))
    await current.runtime.dispose()
  })

  test("reset remounts the same immutable artifact with fresh local state and no API call", async () => {
    const current = fixture()
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())
    const first = current.mount.mock.calls[0]![0]
    await first.collaborativeStateBridge.change({ count: 2 })

    await current.runtime.reset()
    expect(current.mount).toHaveBeenCalledTimes(2)
    const second = current.mount.mock.calls[1]![0]
    expect(second.artifact).toBe(first.artifact)
    expect(second.functionBridge).not.toBe(first.functionBridge)
    expect(await second.collaborativeStateBridge.get()).toEqual({ version: 1, value: null })
    expect(current.getPreview).not.toHaveBeenCalled()
    expect(current.getDraft).not.toHaveBeenCalled()
    expect(current.build).not.toHaveBeenCalled()
    expect(current.close).not.toHaveBeenCalled()
    await current.runtime.dispose()
  })

  test("refresh CAS-swaps the exact draft and Preview revisions and persists both", async () => {
    const next = ready({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    const build = vi.fn(async () => [undefined, next] as const)
    const current = fixture({ build })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())
    expect(build).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      expectedDraftRevision: DRAFT_REVISION_TWO,
      expectedActivePreviewRevisionId: PREVIEW_REVISION_ONE,
    })
    expect(current.mount).toHaveBeenCalledTimes(2)
    expect(current.persist).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    await current.runtime.dispose()
  })

  test("adopts the committed refresh authority before artifact verification fails", async () => {
    const next = ready({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
      artifact: { ...uiArtifact(), digestSha256: "0".repeat(64) },
    })
    const current = fixture({
      build: vi.fn(async () => [undefined, next] as const),
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())

    expect(current.mount).toHaveBeenCalledOnce()
    expect(current.cleanup).not.toHaveBeenCalled()
    expect(current.persist).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    expect(root?.textContent).toContain("digest mismatch")

    await current.runtime.reset()
    expect(current.mount).toHaveBeenCalledOnce()
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    expect(current.resetState).toHaveBeenLastCalledWith({ disabled: true })

    await current.runtime.dispose()
    expect(current.release).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
  })

  test("keeps the committed refresh authority when the replacement mount fails", async () => {
    const cleanup = vi.fn()
    const mount = vi.fn()
      .mockImplementationOnce(() => cleanup)
      .mockImplementationOnce(() => { throw new Error("replacement mount failed") })
    const next = ready({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    const current = fixture({
      build: vi.fn(async () => [undefined, next] as const),
      mount,
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())

    expect(current.mount).toHaveBeenCalledTimes(2)
    expect(cleanup).not.toHaveBeenCalled()
    expect(current.persist).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    expect(root?.textContent).toContain("replacement mount failed")

    await current.runtime.reset()
    expect(current.mount).toHaveBeenCalledTimes(2)
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    expect(current.resetState).toHaveBeenLastCalledWith({ disabled: true })

    await current.runtime.dispose()
    expect(current.release).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
  })

  test("re-fetches and adopts the exact active revision when a refresh loses CAS", async () => {
    const active = ready({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    const build = vi.fn(async () => [undefined, {
      ready: false,
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_TWO,
      revision: DRAFT_REVISION_TWO,
      currentRevision: DRAFT_REVISION_TWO,
      reason: "preview-conflict",
      message: "Another refresh won the Preview CAS.",
      diagnostics: [],
    }] as const)
    const current = fixture({
      build,
      getPreview: vi.fn(async () => [undefined, active] as const),
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())
    expect(current.getPreview).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
    })
    expect(current.mount).toHaveBeenCalledTimes(2)
    expect(current.persist).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    await current.runtime.dispose()
  })

  test("fences the inactive mounted revision when a Preview conflict cannot be re-fetched", async () => {
    const build = vi.fn(async () => [undefined, {
      ready: false,
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_TWO,
      revision: DRAFT_REVISION_TWO,
      currentRevision: DRAFT_REVISION_TWO,
      reason: "preview-conflict",
      message: "Another refresh won the Preview CAS.",
      diagnostics: [],
    }] as const)
    const current = fixture({
      build,
      getPreview: vi.fn(async () => [{ message: "active Preview unavailable" }, undefined] as const),
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())
    await current.runtime.reset()

    expect(current.mount).toHaveBeenCalledOnce()
    expect(current.persist).not.toHaveBeenCalled()
    expect(current.resetState).toHaveBeenLastCalledWith({ disabled: true })
    expect(root?.textContent).toContain("active Preview unavailable")
    await current.runtime.dispose()
  })

  test("fences a cached revision when a post-commit build failure leaves no active Preview", async () => {
    const build = vi.fn(async () => [undefined, {
      ready: false,
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_TWO,
      revision: DRAFT_REVISION_TWO,
      currentRevision: DRAFT_REVISION_TWO,
      reason: "artifact-unavailable",
      message: "Committed Preview artifact could not be read.",
      diagnostics: ["artifact unavailable"],
    }] as const)
    const current = fixture({
      build,
      getPreview: vi.fn(async () => [undefined, {
        ready: false,
        draftId: DRAFT_ID,
        previewId: PREVIEW_ID,
        reason: "not-built",
        message: "Preview has not been built for this draft.",
        diagnostics: [],
      }] as const),
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())
    await current.runtime.reset()

    expect(current.mount).toHaveBeenCalledOnce()
    expect(current.persist).not.toHaveBeenCalled()
    expect(current.resetState).toHaveBeenLastCalledWith({ disabled: true })
    expect(root?.textContent).toContain("Committed Preview artifact could not be read.")
    await current.runtime.dispose()
  })

  test("recovers and adopts a committed Preview after the build transport loses its response", async () => {
    const active = ready({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    const current = fixture({
      build: vi.fn(async () => [{ message: "response transport lost" }, undefined] as const),
      getPreview: vi.fn(async () => [undefined, active] as const),
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())

    expect(current.getPreview).toHaveBeenCalledOnce()
    expect(current.mount).toHaveBeenCalledTimes(2)
    expect(current.persist).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    expect(current.runtime.getOwnedRevision()).toBe(DRAFT_REVISION_TWO)
    expect(current.runtime.getOwnedPreviewRevisionId()).toBe(PREVIEW_REVISION_TWO)
    await current.runtime.dispose()
  })

  test("fences cached authority when a build transport failure leaves no active Preview", async () => {
    const current = fixture({
      build: vi.fn(async () => [{ message: "response transport lost" }, undefined] as const),
      getPreview: vi.fn(async () => [undefined, {
        ready: false,
        draftId: DRAFT_ID,
        previewId: PREVIEW_ID,
        reason: "not-built",
        message: "Preview has not been built for this draft.",
        diagnostics: [],
      }] as const),
    })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())

    await current.runtime.refresh(summary())
    await current.runtime.reset()

    expect(current.mount).toHaveBeenCalledOnce()
    expect(current.persist).not.toHaveBeenCalled()
    expect(current.resetState).toHaveBeenLastCalledWith({ disabled: true })
    expect(root?.textContent).toContain("response transport lost")
    await current.runtime.dispose()
  })

  test("releases both exact authorities when a refresh completes after disposal", async () => {
    let resolveBuild!: (value: readonly [undefined, TDraftPreviewReady]) => void
    const build = vi.fn(() => new Promise<readonly [undefined, TDraftPreviewReady]>((resolve) => {
      resolveBuild = resolve
    }))
    const current = fixture({ build })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())
    const refreshing = current.runtime.refresh(summary())
    await vi.waitFor(() => expect(build).toHaveBeenCalledOnce())
    const disposing = current.runtime.dispose()
    resolveBuild([undefined, ready({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })])
    await Promise.all([refreshing, disposing])

    expect(current.mount).toHaveBeenCalledOnce()
    expect(current.release).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_TWO,
      previewRevisionId: PREVIEW_REVISION_TWO,
    })
    expect(current.release).toHaveBeenCalledWith({
      draftRevision: DRAFT_REVISION_ONE,
      previewRevisionId: PREVIEW_REVISION_ONE,
    })
  })

  test("server-backed artifacts invoke only through their exact Preview subject", async () => {
    const descriptor = functionDescriptor()
    const invocation = {
      id: "40000000-0000-4000-8000-000000000001",
      functionName: descriptor.exportName,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_ONE,
      status: "succeeded" as const,
      output: { temperature: 21 },
      failure: null,
      createdAtMs: 1,
      startedAtMs: 1,
      finishedAtMs: 1,
    }
    const invoke = vi.fn(async () => [undefined, invocation] as const)
    const current = fixture({ initial: ready({ functions: [descriptor] }), invoke })
    await vi.waitFor(() => expect(current.mount).toHaveBeenCalledOnce())
    const bridge = current.mount.mock.calls[0]![0].functionBridge

    await expect(bridge.invoke({
      functionName: descriptor.exportName,
      input: { city: "Berlin" },
      idempotencyKey: "weather-1",
    })).resolves.toEqual({ temperature: 21 })
    expect(invoke).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_ONE,
      functionName: descriptor.exportName,
      input: { city: "Berlin" },
      idempotencyKey: "weather-1",
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("widgetInstanceId")
    await current.runtime.dispose()
  })

  test("rejects mismatched invocation ownership and cancels work on disposal", async () => {
    const descriptor = functionDescriptor()
    const queued = {
      id: "40000000-0000-4000-8000-000000000001",
      functionName: descriptor.exportName,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_ONE,
      status: "queued" as const,
      output: null,
      failure: null,
      createdAtMs: 1,
      startedAtMs: null,
      finishedAtMs: null,
    }
    const invoke = vi.fn(async () => [undefined, queued] as const)
    const cancel = vi.fn(async () => [undefined, { ...queued, status: "cancelled" as const }] as const)
    const wait = vi.fn((_timeout: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })
    }))
    const bridge = createPreviewFunctionHostBridge({
      api: {
        api: {
          agent: {
            widgetPreview: {
              invoke,
              invocation: { get: vi.fn(), cancel },
            },
          },
        },
      } as never,
      draftId: DRAFT_ID,
      identity: {
        kind: "agent_preview",
        definitionId: DEFINITION_ID,
        previewId: PREVIEW_ID,
        previewRevisionId: PREVIEW_REVISION_ONE,
      },
      functionDescriptors: [descriptor],
      createId: () => "preview-function-key",
      nowMs: () => 1,
      wait,
      isCurrent: () => true,
      onLogError: vi.fn(),
    })
    const pending = bridge.invoke({
      functionName: descriptor.exportName,
      input: {},
      idempotencyKey: "weather-2",
    })
    await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce())
    bridge.dispose()
    await expect(pending).rejects.toThrow()
    expect(cancel).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      previewId: PREVIEW_ID,
      previewRevisionId: PREVIEW_REVISION_ONE,
      invocationId: queued.id,
    })
  })
})
