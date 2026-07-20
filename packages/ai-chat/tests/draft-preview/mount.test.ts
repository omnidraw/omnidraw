import { afterEach, describe, expect, it, vi } from "vitest"
import { mountDraftPreview } from "../../src/draft-preview/mount"
import type { TDraftPreviewReady } from "../../src/draft-preview/typed"
import { mountArrowSandboxBridge, type TArrowSandboxBridge } from "../../src/widget/mount-arrow-sandbox"

let root: HTMLDivElement | undefined

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function ready(revision: string, state = "idle", currentRevision = revision): TDraftPreviewReady {
  return {
    ready: true,
    draftId: "Weather",
    name: "Weather",
    revision,
    currentRevision,
    stale: currentRevision !== revision,
    manifest: {} as TDraftPreviewReady["manifest"],
    sources: { "main.ts": `export const revision = '${revision}'` },
    snapshot: { state, context: { revision, state } },
    diagnostics: [],
  }
}

function createRoot() {
  root = document.createElement("div")
  document.body.appendChild(root)
  return root
}

afterEach(() => {
  root?.remove()
  root = undefined
})

describe("draft Preview runtime", () => {
  it("keeps a prepared Preview disposable when sandbox mounting throws", async () => {
    const returnEvents = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>)
    const nextEvent = vi.fn(() => new Promise<IteratorResult<unknown>>(() => undefined))
    const releaseRevision = vi.fn()
    const logError = vi.fn()
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, {
              [Symbol.asyncIterator]() {
                return { next: nextEvent, return: returnEvents }
              },
            }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn(() => { throw new Error("Injected sandbox mount failure.") }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: releaseRevision,
      onLogError: logError,
    })

    expect(root?.textContent).toContain("Injected sandbox mount failure")
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ message: "Injected sandbox mount failure." }))
    await vi.waitFor(() => expect(nextEvent).toHaveBeenCalledOnce())

    await runtime.dispose()
    expect(returnEvents).toHaveBeenCalledOnce()
    expect(releaseRevision).toHaveBeenCalledWith("rev-1")
  })

  it("unsubscribes the actor bridge when sandbox mounting fails after subscription", () => {
    const sandboxRoot = createRoot()
    const unsubscribe = vi.fn()
    sandboxRoot.querySelectorAll = vi.fn(() => { throw new Error("Injected sandbox binding failure.") }) as never

    expect(() => mountArrowSandboxBridge({
      root: sandboxRoot,
      onError: vi.fn(),
    }, {
      sources: { "main.ts": "export default {}" },
      bridge: {
        getSnapshot: vi.fn(),
        sendMessage: vi.fn(),
        subscribeSnapshots: vi.fn(() => unsubscribe),
      },
    })).toThrow("Injected sandbox binding failure")
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(sandboxRoot.childElementCount).toBe(0)
  })

  it("bridges pinned snapshots and messages, refetches matching events, and cleans up", async () => {
    let resolveEvent!: (result: IteratorResult<unknown>) => void
    const returnEvents = vi.fn(async () => ({ done: true, value: undefined }) as IteratorResult<unknown>)
    const nextEvent = vi.fn(() => new Promise<IteratorResult<unknown>>((resolve) => { resolveEvent = resolve }))
    const getPreview = vi.fn(async () => [undefined, ready("rev-1", "updated")] as const)
    const pendingSend = deferred<readonly [undefined, {
      ready: true,
      revision: "rev-1",
      messageId: "message-1",
      snapshot: { state: "sent", context: { count: 1 } },
    }]>()
    const sendPreview = vi.fn(() => pendingSend.promise)
    const cleanupSandbox = vi.fn()
    let bridge: TArrowSandboxBridge | undefined
    const mountSandbox = vi.fn((_portal, sandboxArgs) => {
      bridge = sandboxArgs.bridge
      return cleanupSandbox
    })
    const releaseRevision = vi.fn()
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: getPreview,
              build: vi.fn(),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: vi.fn(),
              send: sendPreview,
            },
            events: async () => [undefined, {
              [Symbol.asyncIterator]() {
                return { next: nextEvent, return: returnEvents }
              },
            }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: mountSandbox as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: releaseRevision,
      onLogError: vi.fn(),
    })

    expect(mountSandbox).toHaveBeenCalledOnce()
    expect(await bridge?.getSnapshot()).toMatchObject({ status: "running", state: "idle", context: { revision: "rev-1" } })
    const snapshots = vi.fn()
    const unsubscribe = bridge?.subscribeSnapshots(snapshots)
    const sending = bridge?.sendMessage({ name: "increment", payload: { by: 1 } })
    expect(sendPreview).toHaveBeenCalledWith({
      draftId: "Weather",
      previewId: "preview-1",
      expectedRevision: "rev-1",
      name: "increment",
      payload: { by: 1 },
    })
    expect(snapshots).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(nextEvent).toHaveBeenCalledOnce())
    resolveEvent({
      done: false,
      value: { kind: "widget-preview", type: "changed", draftId: "Weather", revision: "rev-1" },
    })
    await vi.waitFor(() => expect(getPreview).toHaveBeenCalledWith({ draftId: "Weather", previewId: "preview-1" }))
    await vi.waitFor(() => expect(snapshots).toHaveBeenCalledWith(expect.objectContaining({ state: "updated" })))

    pendingSend.resolve([undefined, {
      ready: true,
      revision: "rev-1",
      messageId: "message-1",
      snapshot: { state: "sent", context: { count: 1 } },
    }])
    expect(await sending).toEqual({ ok: true, messageId: "message-1" })
    expect(snapshots).not.toHaveBeenCalledWith(expect.objectContaining({ state: "sent" }))
    expect(await bridge?.getSnapshot()).toMatchObject({ state: "updated" })

    unsubscribe?.()
    runtime.dispose()
    expect(cleanupSandbox).toHaveBeenCalledOnce()
    expect(returnEvents).toHaveBeenCalledOnce()
    expect(releaseRevision).toHaveBeenCalledWith("rev-1")
  })

  it("ignores Preview events for unrelated drafts and revisions", async () => {
    const getPreview = vi.fn(async () => [undefined, ready("rev-1", "updated")] as const)
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: getPreview,
              build: vi.fn(),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, {
              async *[Symbol.asyncIterator]() {
                yield { kind: "widget-preview", type: "changed", draftId: "Other", revision: "rev-1" }
                yield { kind: "widget-preview", type: "changed", draftId: "Weather", revision: "rev-other" }
                yield { kind: "widget-preview", type: "changed", draftId: "Weather", revision: "rev-1" }
              },
            }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn(() => () => {}) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    await vi.waitFor(() => expect(getPreview).toHaveBeenCalledOnce())
    expect(getPreview).toHaveBeenCalledWith({ draftId: "Weather", previewId: "preview-1" })
    runtime.dispose()
  })

  it("ignores an obsolete event-refetch failure after refresh adopts a newer revision", async () => {
    const pendingGet = deferred<readonly [{ message: string }, undefined]>()
    const getPreview = vi.fn(() => pendingGet.promise)
    const cleanupFirstSandbox = vi.fn()
    const cleanupSecondSandbox = vi.fn()
    let mountCount = 0
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: getPreview,
              build: vi.fn(),
              refresh: vi.fn(async () => [undefined, ready("rev-2")] as const),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, {
              async *[Symbol.asyncIterator]() {
                yield { kind: "widget-preview", type: "changed", draftId: "Weather", revision: "rev-1" }
                await new Promise(() => {})
              },
            }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn(() => (++mountCount === 1 ? cleanupFirstSandbox : cleanupSecondSandbox)) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    await vi.waitFor(() => expect(getPreview).toHaveBeenCalledOnce())
    await runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" })
    pendingGet.resolve([{ message: "obsolete rev-1 refetch failed" }, undefined])
    await Promise.resolve()

    expect(runtime.getOwnedRevision()).toBe("rev-2")
    expect(root?.querySelector(".vc-draft-preview__sandbox-error")).toBeNull()
    expect(root?.textContent).not.toContain("obsolete rev-1 refetch failed")
    expect(cleanupSecondSandbox).not.toHaveBeenCalled()

    await runtime.dispose()
  })

  it("does not start a refresh mutation after disposal while draft lookup is pending", async () => {
    const pendingDraft = deferred<readonly [undefined, {
      draftId: string
      name: string
      displayName: string
      revision: string
    }]>()
    const refreshPreview = vi.fn()
    const releaseRevision = vi.fn()
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn(() => pendingDraft.promise) },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: refreshPreview,
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn(() => () => {}) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: releaseRevision,
      onLogError: vi.fn(),
    })

    const refreshing = runtime.refresh()
    const disposing = runtime.dispose()
    pendingDraft.resolve([undefined, {
      draftId: "Weather",
      name: "Weather",
      displayName: "Weather",
      revision: "rev-2",
    }])
    await Promise.all([refreshing, disposing])

    expect(refreshPreview).not.toHaveBeenCalled()
    expect(releaseRevision).toHaveBeenCalledTimes(1)
    expect(releaseRevision).toHaveBeenCalledWith("rev-1")
  })

  it("waits for an in-flight replacement and releases its late owned revision on disposal", async () => {
    const pendingRefresh = deferred<readonly [undefined, TDraftPreviewReady]>()
    const releaseRevision = vi.fn()
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(() => pendingRefresh.promise),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn(() => () => {}) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: releaseRevision,
      onLogError: vi.fn(),
    })

    const refreshing = runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" })
    const disposing = runtime.dispose()
    expect(releaseRevision).toHaveBeenCalledWith("rev-1")
    pendingRefresh.resolve([undefined, ready("rev-2")])
    await Promise.all([refreshing, disposing])

    expect(releaseRevision).toHaveBeenCalledTimes(2)
    expect(releaseRevision).toHaveBeenLastCalledWith("rev-2")
  })

  it("ignores an old send completion after refresh adopts a new revision", async () => {
    const pendingSend = deferred<readonly [undefined, {
      ready: true,
      revision: string,
      messageId: string,
      snapshot: { state: string, context: unknown },
    }]>()
    const cleanupFirstSandbox = vi.fn()
    const cleanupSecondSandbox = vi.fn()
    const bridges: TArrowSandboxBridge[] = []
    const mountSandbox = vi.fn((_portal, sandboxArgs) => {
      bridges.push(sandboxArgs.bridge)
      return bridges.length === 1 ? cleanupFirstSandbox : cleanupSecondSandbox
    })
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(async () => [undefined, ready("rev-2")] as const),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(() => pendingSend.promise),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: mountSandbox as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    const sending = bridges[0]!.sendMessage({ name: "increment", payload: { by: 1 } })
    await runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" })
    expect(cleanupFirstSandbox).toHaveBeenCalledOnce()
    expect(runtime.getOwnedRevision()).toBe("rev-2")

    pendingSend.resolve([undefined, {
      ready: true,
      revision: "rev-1",
      messageId: "message-old",
      snapshot: { state: "old-send", context: { revision: "rev-1" } },
    }])
    expect(await sending).toEqual({ ok: true, messageId: "message-old" })
    expect(await bridges[1]!.getSnapshot()).toMatchObject({ state: "idle", context: { revision: "rev-2" } })
    expect(cleanupSecondSandbox).not.toHaveBeenCalled()

    runtime.dispose()
    expect(cleanupSecondSandbox).toHaveBeenCalledOnce()
  })

  it("ignores a failed send completion after disposal", async () => {
    const pendingSend = deferred<readonly [undefined, {
      ready: false,
      draftId: string,
      revision: string,
      currentRevision: string,
      reason: string,
      message: string,
      diagnostics: string[],
    }]>()
    const cleanupSandbox = vi.fn()
    let bridge: TArrowSandboxBridge | undefined
    const releaseRevision = vi.fn()
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(() => pendingSend.promise),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn((_portal, sandboxArgs) => {
        bridge = sandboxArgs.bridge
        return cleanupSandbox
      }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: releaseRevision,
      onLogError: vi.fn(),
    })

    const sending = bridge!.sendMessage({ name: "increment", payload: {} })
    runtime.dispose()
    pendingSend.resolve([undefined, {
      ready: false,
      draftId: "Weather",
      revision: "rev-1",
      currentRevision: "rev-2",
      reason: "stale-revision",
      message: "Late stale response must not render.",
      diagnostics: [],
    }])

    expect(await sending).toMatchObject({ ok: false })
    expect(cleanupSandbox).toHaveBeenCalledOnce()
    expect(releaseRevision).toHaveBeenCalledOnce()
    expect(root?.textContent).not.toContain("Late stale response must not render.")
  })

  it("keeps the immutable sandbox mounted when send reports a stale revision", async () => {
    const cleanupSandbox = vi.fn()
    let bridge: TArrowSandboxBridge | undefined
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(async () => [undefined, {
                ready: false,
                draftId: "Weather",
                revision: "rev-1",
                currentRevision: "rev-2",
                reason: "stale-revision",
                message: "Refresh Preview before interacting with this changed draft.",
                diagnostics: [],
              }] as const),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn((_portal, sandboxArgs) => {
        bridge = sandboxArgs.bridge
        return cleanupSandbox
      }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    expect(await bridge!.sendMessage({ name: "increment", payload: {} })).toMatchObject({ ok: false })
    expect(cleanupSandbox).not.toHaveBeenCalled()
    expect(root?.querySelector(".vc-draft-preview__sandbox")).not.toBeNull()
    expect(root?.textContent).toContain("Refresh Preview before interacting with this changed draft.")
    expect(root?.querySelector<HTMLElement>(".vc-draft-preview__stale")?.hidden).toBe(false)
    expect(await bridge!.getSnapshot()).toMatchObject({ state: "idle", context: { revision: "rev-1" } })

    runtime.dispose()
    expect(cleanupSandbox).toHaveBeenCalledOnce()
  })

  it("keeps a changed draft stale until refresh adopts and persists the newest ready revision", async () => {
    const cleanupFirstSandbox = vi.fn()
    const cleanupSecondSandbox = vi.fn()
    let mountCount = 0
    const mountSandbox = vi.fn(() => (++mountCount === 1 ? cleanupFirstSandbox : cleanupSecondSandbox))
    const refreshPreview = vi.fn(async () => [undefined, ready("rev-2")] as const)
    const persistRevision = vi.fn()
    const releaseRevision = vi.fn()
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: refreshPreview,
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1", "idle", "rev-2"),
      mountSandbox: mountSandbox as never,
      onPersistRevision: persistRevision,
      onReleaseRevision: releaseRevision,
      onLogError: vi.fn(),
    })

    expect(root?.textContent).toContain("Stale")
    expect(runtime.getOwnedRevision()).toBe("rev-1")
    await runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" })
    expect(refreshPreview).toHaveBeenCalledWith({ draftId: "Weather", previewId: "preview-1", expectedRevision: "rev-2" })
    expect(cleanupFirstSandbox).toHaveBeenCalledOnce()
    expect(mountSandbox).toHaveBeenCalledTimes(2)
    expect(persistRevision).toHaveBeenCalledWith("rev-2")
    expect(runtime.getOwnedRevision()).toBe("rev-2")
    expect(root?.querySelector<HTMLElement>(".vc-draft-preview__stale")?.hidden).toBe(true)

    runtime.dispose()
    expect(cleanupSecondSandbox).toHaveBeenCalledOnce()
    expect(releaseRevision).toHaveBeenCalledWith("rev-2")
  })

  it("preserves the current sandbox when refresh or reset reports a stale conflict", async () => {
    const cleanupSandbox = vi.fn()
    let bridge: TArrowSandboxBridge | undefined
    const staleFailure = {
      ready: false as const,
      draftId: "Weather",
      revision: "rev-1",
      currentRevision: "rev-2",
      reason: "stale-revision",
      message: "The draft changed before the operation was accepted.",
      diagnostics: [],
    }
    const refreshPreview = vi.fn(async () => [undefined, staleFailure] as const)
    const resetPreview = vi.fn(async () => [undefined, staleFailure] as const)
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: refreshPreview,
              reset: resetPreview,
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn((_portal, sandboxArgs) => {
        bridge = sandboxArgs.bridge
        return cleanupSandbox
      }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    await runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" })
    expect(refreshPreview).toHaveBeenCalledWith({ draftId: "Weather", previewId: "preview-1", expectedRevision: "rev-2" })
    expect(cleanupSandbox).not.toHaveBeenCalled()
    expect(root?.querySelector(".vc-draft-preview__sandbox")).not.toBeNull()
    expect(root?.textContent).toContain(staleFailure.message)
    expect(await bridge!.getSnapshot()).toMatchObject({ state: "idle", context: { revision: "rev-1" } })

    await runtime.reset()
    expect(resetPreview).toHaveBeenCalledWith({ draftId: "Weather", previewId: "preview-1", expectedRevision: "rev-1" })
    expect(cleanupSandbox).not.toHaveBeenCalled()
    expect(root?.querySelector(".vc-draft-preview__sandbox")).not.toBeNull()

    runtime.dispose()
    expect(cleanupSandbox).toHaveBeenCalledOnce()
  })

  it("preserves the current sandbox when refresh fails to build the replacement", async () => {
    const cleanupSandbox = vi.fn()
    let bridge: TArrowSandboxBridge | undefined
    const failure = {
      ready: false as const,
      draftId: "Weather",
      revision: "rev-2",
      currentRevision: "rev-2",
      reason: "validation-failed",
      message: "Fix validation errors before Preview can refresh.",
      diagnostics: ["widget/main.ts: invalid"],
    }
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(async () => [undefined, failure] as const),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn((_portal, sandboxArgs) => {
        bridge = sandboxArgs.bridge
        return cleanupSandbox
      }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    await runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" })
    expect(cleanupSandbox).not.toHaveBeenCalled()
    expect(root?.querySelector(".vc-draft-preview__sandbox")).not.toBeNull()
    expect(root?.textContent).toContain(failure.message)
    expect(root?.querySelector("[role='alert']")).not.toBeNull()
    expect(await bridge!.getSnapshot()).toMatchObject({ state: "idle", context: { revision: "rev-1" } })

    runtime.dispose()
    expect(cleanupSandbox).toHaveBeenCalledOnce()
  })

  it("closes an attempted revision when a refresh response is lost", async () => {
    const cleanupSandbox = vi.fn()
    const closePreview = vi.fn(async () => [undefined, {
      closed: true,
      draftId: "Weather",
      revision: "rev-2",
    }] as const)
    let bridge: TArrowSandboxBridge | undefined
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-runtime-owner",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: vi.fn(async () => [{ message: "Preview refresh response was lost." }, undefined] as const),
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn((_portal, sandboxArgs) => {
        bridge = sandboxArgs.bridge
        return cleanupSandbox
      }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    await expect(runtime.refresh({
      draftId: "Weather",
      name: "Weather",
      displayName: "Weather",
      revision: "rev-2",
    })).rejects.toThrow("response was lost")

    expect(closePreview).toHaveBeenCalledOnce()
    expect(closePreview).toHaveBeenCalledWith({
      draftId: "Weather",
      previewId: "preview-runtime-owner",
      expectedRevision: "rev-2",
    })
    expect(cleanupSandbox).not.toHaveBeenCalled()
    expect(await bridge!.getSnapshot()).toMatchObject({ state: "idle", context: { revision: "rev-1" } })
    expect(root?.textContent).toContain("Preview refresh response was lost.")

    await runtime.dispose()
  })

  it("serializes same-owner mutations so an older completion cannot close a newer replacement", async () => {
    const firstRefresh = deferred<readonly [undefined, TDraftPreviewReady]>()
    const secondRefresh = deferred<readonly [undefined, TDraftPreviewReady]>()
    const refreshPreview = vi.fn()
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise)
    const closePreview = vi.fn()
    const bridges: TArrowSandboxBridge[] = []
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-runtime-owner",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: refreshPreview,
              reset: vi.fn(),
              close: closePreview,
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1"),
      mountSandbox: vi.fn((_portal, sandboxArgs) => {
        bridges.push(sandboxArgs.bridge)
        return () => {}
      }) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })
    const summary = { draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-2" }

    const older = runtime.refresh(summary)
    const newer = runtime.refresh(summary)
    await vi.waitFor(() => expect(refreshPreview).toHaveBeenCalledTimes(1))

    firstRefresh.resolve([undefined, ready("rev-2", "first")])
    await older
    await vi.waitFor(() => expect(refreshPreview).toHaveBeenCalledTimes(2))
    secondRefresh.resolve([undefined, ready("rev-2", "second")])
    await newer

    expect(closePreview).not.toHaveBeenCalled()
    expect(runtime.getOwnedRevision()).toBe("rev-2")
    expect(await bridges.at(-1)!.getSnapshot()).toMatchObject({ state: "second" })
    await runtime.dispose()
  })

  it("does not release a ready Preview merely observed by a late get", async () => {
    const pendingGet = deferred<readonly [undefined, TDraftPreviewReady]>()
    const releaseRevision = vi.fn()
    const mountSandbox = vi.fn()
    const getPreview = vi.fn(() => pendingGet.promise)
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: {
              get: vi.fn(async () => [undefined, {
                draftId: "Weather",
                name: "Weather",
                displayName: "Weather",
                revision: "rev-1",
              }] as const),
            },
            widgetPreview: {
              get: getPreview,
              build: vi.fn(),
              refresh: vi.fn(),
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      mountSandbox: mountSandbox as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: releaseRevision,
      onLogError: vi.fn(),
    })

    await vi.waitFor(() => expect(getPreview).toHaveBeenCalledOnce())
    runtime.dispose()
    pendingGet.resolve([undefined, ready("rev-1")])
    await vi.waitFor(() => expect(releaseRevision).toHaveBeenCalledTimes(1))
    expect(releaseRevision).toHaveBeenCalledWith("rev-1")
    expect(mountSandbox).not.toHaveBeenCalled()
  })

  it("surfaces Preview transport and actor failures inside the frame", async () => {
    const refreshPreview = vi.fn(async () => [{ message: "Preview transport offline" }, undefined] as const)
    const runtime = mountDraftPreview({
      root: createRoot(),
      previewId: "preview-1",
      api: {
        api: {
          agent: {
            widgetDraft: { get: vi.fn() },
            widgetPreview: {
              get: vi.fn(),
              build: vi.fn(),
              refresh: refreshPreview,
              reset: vi.fn(),
              close: vi.fn(),
              send: vi.fn(),
            },
            events: async () => [undefined, { async *[Symbol.asyncIterator]() {} }],
          },
        },
      } as never,
      payload: {
        draftId: "Weather",
        pinnedRevision: "rev-1",
        originChatElementId: "chat-1",
      },
      initialResult: ready("rev-1", "error"),
      mountSandbox: vi.fn(() => () => {}) as never,
      onPersistRevision: vi.fn(),
      onReleaseRevision: vi.fn(),
      onLogError: vi.fn(),
    })

    expect(root?.textContent).toContain("The Preview actor entered an error state")
    await expect(runtime.refresh({ draftId: "Weather", name: "Weather", displayName: "Weather", revision: "rev-1" }))
      .rejects.toThrow("Preview transport offline")
    expect(root?.textContent).toContain("Preview transport offline")
    expect(root?.querySelector("[role='alert']")).not.toBeNull()
    runtime.dispose()
  })
})
