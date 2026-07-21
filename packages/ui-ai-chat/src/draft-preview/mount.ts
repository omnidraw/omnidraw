import type { TWidgetError } from "@vibecanvas/service-db/model"
import type {
  TDraftPreviewFailure,
  TDraftPreviewReady,
  TDraftPreviewResult,
  TDraftPreviewRuntime,
  TDraftPreviewSendResult,
  TDraftPreviewSummary,
  TMountDraftPreviewArgs,
} from "./typed"
import "./widget.css"

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error.trim()
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return fallback
}

function toFailure(args: {
  draftId: string
  revision: string
  reason: TDraftPreviewFailure["reason"]
  message: string
  diagnostics?: string[]
}): TDraftPreviewFailure {
  return {
    ready: false,
    draftId: args.draftId,
    revision: args.revision,
    reason: args.reason,
    message: args.message,
    diagnostics: args.diagnostics ?? [],
  }
}

function actorErrorMessage(snapshot: TDraftPreviewReady["snapshot"]) {
  if (snapshot.state !== "error") return undefined
  if (typeof snapshot.context === "object" && snapshot.context !== null && "message" in snapshot.context) {
    const message = (snapshot.context as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return "The Preview actor entered an error state. Reset Preview to try again."
}

function closeIterator(iterator: AsyncIterator<unknown> | undefined) {
  if (!iterator?.return) return
  try {
    const closing = iterator.return()
    if (closing) void Promise.resolve(closing).catch(() => undefined)
  } catch {
    // Cleanup must remain safe when an iterator closes synchronously.
  }
}

export function mountDraftPreview(args: TMountDraftPreviewArgs): TDraftPreviewRuntime {
  const dom = args.root.ownerDocument
  const shell = dom.createElement("section")
  const body = dom.createElement("div")
  let disposed = false
  let requestId = 0
  let ownedRevision = args.payload.pinnedRevision
  let currentRevision = args.payload.pinnedRevision
  let currentReady: TDraftPreviewReady | undefined
  let cleanupSandbox: (() => void) | undefined
  let eventIterator: AsyncIterator<unknown> | undefined
  let disposalPromise: Promise<void> | undefined
  let mutationTail: Promise<void> | undefined
  const activeOperations = new Set<Promise<unknown>>()
  const snapshotSubscribers = new Set<(snapshot: {
    status: "running" | "error"
    state: string
    context: unknown
    error: TWidgetError | null
  }) => void>()

  const trackOperation = <T>(operation: Promise<T>): Promise<T> => {
    activeOperations.add(operation)
    void operation.then(
      () => activeOperations.delete(operation),
      () => activeOperations.delete(operation),
    )
    return operation
  }

  const enqueueMutation = (operation: () => Promise<void>) => {
    if (disposed) return Promise.resolve()
    const previous = mutationTail
    const queued = previous
      ? previous.catch(() => undefined).then(() => disposed ? undefined : operation())
      : operation()
    const tail = queued.catch(() => undefined)
    mutationTail = tail
    void tail.then(() => {
      if (mutationTail === tail) mutationTail = undefined
    })
    return trackOperation(queued)
  }

  shell.className = "vc-draft-preview"
  shell.setAttribute("aria-label", `${args.payload.draftId} Preview`)
  body.className = "vc-draft-preview__body"
  shell.append(body)
  args.root.replaceChildren(shell)

  const setBusy = (message: string) => {
    cleanupSandbox?.()
    cleanupSandbox = undefined
    currentReady = undefined
    body.replaceChildren()
    const loading = dom.createElement("div")
    loading.className = "vc-draft-preview__state vc-draft-preview__state--loading"
    loading.setAttribute("role", "status")
    loading.setAttribute("aria-live", "polite")
    loading.textContent = message
    body.appendChild(loading)
    args.onResetStateChange?.({ disabled: true })
  }

  const setOperationBusy = (_message: string) => {
    args.onResetStateChange?.({ disabled: true })
  }

  const syncStatus = (_stale: boolean, _message = "") => {
    args.onResetStateChange?.({ disabled: false })
  }

  const renderFailure = (failure: TDraftPreviewFailure) => {
    cleanupSandbox?.()
    cleanupSandbox = undefined
    currentReady = undefined
    if (failure.currentRevision) currentRevision = failure.currentRevision
    const stale = currentRevision !== ownedRevision || failure.reason === "stale-revision"
    syncStatus(stale, failure.reason.replaceAll("-", " "))
    body.replaceChildren()

    const state = dom.createElement("div")
    const heading = dom.createElement("strong")
    const message = dom.createElement("p")
    state.className = "vc-draft-preview__state vc-draft-preview__state--error"
    state.setAttribute("role", "alert")
    heading.textContent = failure.reason === "stale-revision" ? "Preview revision is stale" : "Preview could not load"
    message.textContent = failure.message
    state.append(heading, message)

    if (failure.diagnostics.length > 0) {
      const diagnostics = dom.createElement("ul")
      diagnostics.className = "vc-draft-preview__diagnostics"
      failure.diagnostics.slice(0, 12).forEach((diagnostic) => {
        const item = dom.createElement("li")
        item.textContent = diagnostic
        diagnostics.appendChild(item)
      })
      state.appendChild(diagnostics)
    }

    body.appendChild(state)
  }

  const emitSnapshot = (snapshot: TDraftPreviewReady["snapshot"]) => {
    const errorText = actorErrorMessage(snapshot)
    const actorError: TWidgetError | null = errorText ? {
      phase: "sandbox-runtime",
      code: "DRAFT_PREVIEW_ACTOR_ERROR",
      message: errorText,
      retryable: true,
    } : null
    const bridged = {
      status: errorText ? "error" as const : "running" as const,
      state: snapshot.state,
      context: snapshot.context,
      error: actorError,
    }
    snapshotSubscribers.forEach((subscriber) => subscriber(bridged))
  }

  const renderSandboxError = (error: TWidgetError) => {
    body.querySelector(".vc-draft-preview__sandbox-error")?.remove()
    const overlay = dom.createElement("div")
    const heading = dom.createElement("strong")
    const message = dom.createElement("p")
    overlay.className = "vc-draft-preview__sandbox-error"
    overlay.setAttribute("role", "alert")
    heading.textContent = error.phase === "sandbox-compile" ? "Preview compile failed" : "Preview runtime failed"
    message.textContent = error.message
    overlay.append(heading, message)
    body.appendChild(overlay)
  }

  const preserveSandboxFailure = (failure: TDraftPreviewFailure) => {
    if (!currentReady || !cleanupSandbox) {
      renderFailure(failure)
      return
    }
    if (failure.currentRevision) currentRevision = failure.currentRevision
    const stale = currentRevision !== ownedRevision || failure.reason === "stale-revision"
    if (failure.reason !== "stale-revision") {
      renderSandboxError({
        phase: "snapshot",
        code: `DRAFT_PREVIEW_${failure.reason.replaceAll("-", "_").toUpperCase()}`,
        message: failure.message,
        retryable: true,
      })
    }
    syncStatus(stale, failure.message)
  }

  const callDraftGet = async (): Promise<TDraftPreviewSummary> => {
    const [error, summary] = await args.api.api.agent.widgetDraft.get({ draftId: args.payload.draftId })
    if (error) throw new Error(errorMessage(error, "Could not read the widget draft."))
    if (!summary) throw new Error(`Widget draft '${args.payload.draftId}' was not found.`)
    return summary
  }

  const callPreviewGet = async (): Promise<TDraftPreviewResult> => {
    const [error, result] = await args.api.api.agent.widgetPreview.get({
      draftId: args.payload.draftId,
      previewId: args.previewId,
    })
    if (error) throw new Error(errorMessage(error, "Could not read Preview state."))
    if (!result) throw new Error("Preview state was unavailable.")
    return result
  }

  const closeAttemptedPreview = async (revision: string) => {
    try {
      const [error] = await args.api.api.agent.widgetPreview.close({
        draftId: args.payload.draftId,
        previewId: args.previewId,
        expectedRevision: revision,
      })
      if (error) args.onLogError(error)
    } catch (error) {
      args.onLogError(error)
    }
  }

  const releaseLateMutationResult = (result: TDraftPreviewResult) => {
    if (!result.ready) return
    if (!disposed && result.revision === ownedRevision) return
    args.onReleaseRevision(result.revision)
  }

  const renderReady = (result: TDraftPreviewReady, persistRevision: boolean) => {
    if (disposed) {
      releaseLateMutationResult(result)
      return
    }

    cleanupSandbox?.()
    cleanupSandbox = undefined
    ownedRevision = result.revision
    currentRevision = result.currentRevision
    currentReady = result
    if (persistRevision) args.onPersistRevision(result.revision)
    syncStatus(result.stale || result.currentRevision !== result.revision, actorErrorMessage(result.snapshot) ? "actor error" : "Interactive Preview")
    body.replaceChildren()

    const sandboxRoot = dom.createElement("div")
    sandboxRoot.className = "vc-draft-preview__sandbox"
    body.appendChild(sandboxRoot)
    try {
      cleanupSandbox = args.mountSandbox({
        root: sandboxRoot,
        onError: renderSandboxError,
      }, {
        sources: result.sources,
        bridge: {
          async getSnapshot() {
            const ready = currentReady
            if (!ready) throw new Error("Preview actor is not ready.")
            const message = actorErrorMessage(ready.snapshot)
            return {
              status: message ? "error" : "running",
              state: ready.snapshot.state,
              context: ready.snapshot.context,
              error: message ? {
                phase: "sandbox-runtime",
                code: "DRAFT_PREVIEW_ACTOR_ERROR",
                message,
                retryable: true,
              } : null,
            }
          },
          async sendMessage(message) {
            const ready = currentReady
            if (!ready || ready.revision !== ownedRevision) {
              return { ok: false, code: "DRAFT_PREVIEW_NOT_READY", message: "Preview actor is not ready." }
            }
            if (currentRevision !== ownedRevision) {
              return { ok: false, code: "DRAFT_PREVIEW_STALE", message: "Refresh Preview before sending messages." }
            }

            const sendRequestId = requestId
            const sendRevision = ownedRevision

            try {
              const [error, sendResult] = await args.api.api.agent.widgetPreview.send({
                draftId: args.payload.draftId,
                previewId: args.previewId,
                expectedRevision: ownedRevision,
                name: message.name,
                payload: message.payload,
              })
              if (error) {
                return { ok: false, code: "DRAFT_PREVIEW_SEND_FAILED", message: errorMessage(error, "Preview message failed.") }
              }
              if (!sendResult) {
                return { ok: false, code: "DRAFT_PREVIEW_SEND_FAILED", message: "Preview message returned no result." }
              }
              const result: TDraftPreviewSendResult = sendResult
              const isCurrent = !disposed
                && sendRequestId === requestId
                && sendRevision === ownedRevision
                && currentReady?.revision === sendRevision
              if (!result.ready) {
                if (isCurrent) {
                  if (result.reason === "stale-revision") preserveSandboxFailure(result)
                  else renderFailure(result)
                }
                return { ok: false, code: "DRAFT_PREVIEW_SEND_FAILED", message: result.message }
              }
              if (result.revision !== sendRevision) {
                return { ok: false, code: "DRAFT_PREVIEW_SEND_FAILED", message: "Preview message revision did not match the active Preview." }
              }
              return { ok: true, messageId: result.messageId }
            } catch (error) {
              const message = errorMessage(error, "Preview message failed.")
              if (!disposed && sendRequestId === requestId && sendRevision === ownedRevision) {
                renderSandboxError({
                  phase: "snapshot",
                  code: "DRAFT_PREVIEW_SEND_FAILED",
                  message,
                  retryable: true,
                })
              }
              return { ok: false, code: "DRAFT_PREVIEW_SEND_FAILED", message }
            }
          },
          subscribeSnapshots(handler) {
            snapshotSubscribers.add(handler)
            return () => snapshotSubscribers.delete(handler)
          },
        },
      })
    } catch (error) {
      cleanupSandbox = undefined
      args.onLogError(error)
      renderSandboxError({
        phase: "sandbox-compile",
        code: "DRAFT_PREVIEW_SANDBOX_MOUNT_FAILED",
        message: errorMessage(error, "Preview sandbox could not mount."),
        retryable: true,
      })
    }
    const actorMessage = actorErrorMessage(result.snapshot)
    if (actorMessage) {
      renderSandboxError({
        phase: "sandbox-runtime",
        code: "DRAFT_PREVIEW_ACTOR_ERROR",
        message: actorMessage,
        retryable: true,
      })
    }
  }

  const initialize = async () => {
    const activeRequest = ++requestId
    let attemptedBuildRevision: string | undefined
    setBusy("Loading Preview…")
    try {
      const summary = await callDraftGet()
      if (disposed || activeRequest !== requestId) return
      currentRevision = summary.revision
      const existing = await callPreviewGet()
      if (disposed || activeRequest !== requestId) {
        return
      }
      if (existing.ready && existing.draftId === args.payload.draftId && existing.revision === ownedRevision) {
        renderReady(existing, false)
        return
      }
      if (summary.revision !== ownedRevision) {
        renderFailure(toFailure({
          draftId: args.payload.draftId,
          revision: ownedRevision,
          reason: "stale-revision",
          message: "This persisted Preview revision is no longer built. Refresh to adopt the latest draft revision.",
        }))
        currentRevision = summary.revision
        syncStatus(true, "stale revision")
        return
      }
      attemptedBuildRevision = ownedRevision
      const [error, built] = await args.api.api.agent.widgetPreview.build({
        draftId: args.payload.draftId,
        previewId: args.previewId,
        expectedRevision: ownedRevision,
      })
      if (error) throw new Error(errorMessage(error, "Could not build Preview."))
      if (!built) throw new Error("Preview build returned no result.")
      const result: TDraftPreviewResult = built
      if (disposed || activeRequest !== requestId) {
        releaseLateMutationResult(result)
        return
      }
      if (result.ready) renderReady(result, false)
      else renderFailure(result)
    } catch (error) {
      if (attemptedBuildRevision && (disposed || activeRequest === requestId)) {
        await closeAttemptedPreview(attemptedBuildRevision)
      }
      if (disposed || activeRequest !== requestId) return
      renderFailure(toFailure({
        draftId: args.payload.draftId,
        revision: ownedRevision,
        reason: "transport-failed",
        message: errorMessage(error, "Could not load Preview."),
      }))
    }
  }

  const runRefresh = async (providedSummary?: TDraftPreviewSummary) => {
    const activeRequest = ++requestId
    const previousRevision = ownedRevision
    let attemptedRevision: string | undefined
    setOperationBusy("Refreshing Preview…")
    try {
      const summary = providedSummary ?? await callDraftGet()
      if (disposed || activeRequest !== requestId) return
      currentRevision = summary.revision
      attemptedRevision = summary.revision
      const [error, refreshed] = await args.api.api.agent.widgetPreview.refresh({
        draftId: args.payload.draftId,
        previewId: args.previewId,
        expectedRevision: summary.revision,
      })
      if (error) throw new Error(errorMessage(error, "Could not refresh Preview."))
      if (!refreshed) throw new Error("Preview refresh returned no result.")
      const result: TDraftPreviewResult = refreshed
      if (disposed || activeRequest !== requestId) {
        releaseLateMutationResult(result)
        return
      }
      if (result.ready) renderReady(result, result.revision !== previousRevision)
      else preserveSandboxFailure(result)
    } catch (error) {
      if (attemptedRevision && (disposed || activeRequest === requestId)) {
        await closeAttemptedPreview(attemptedRevision)
      }
      if (!disposed && activeRequest === requestId) {
        preserveSandboxFailure(toFailure({
          draftId: args.payload.draftId,
          revision: previousRevision,
          reason: "transport-failed",
          message: errorMessage(error, "Could not refresh Preview."),
        }))
      }
      throw error
    }
  }

  const refresh = (providedSummary?: TDraftPreviewSummary) => {
    if (disposed) return Promise.resolve()
    return enqueueMutation(() => runRefresh(providedSummary))
  }

  const runReset = async () => {
    const activeRequest = ++requestId
    const revision = ownedRevision
    setOperationBusy("Resetting Preview…")
    try {
      const [error, resetResult] = await args.api.api.agent.widgetPreview.reset({
        draftId: args.payload.draftId,
        previewId: args.previewId,
        expectedRevision: revision,
      })
      if (error) throw new Error(errorMessage(error, "Could not reset Preview."))
      if (!resetResult) throw new Error("Preview reset returned no result.")
      const result: TDraftPreviewResult = resetResult
      if (disposed || activeRequest !== requestId) {
        releaseLateMutationResult(result)
        return
      }
      if (result.ready) renderReady(result, false)
      else preserveSandboxFailure(result)
    } catch (error) {
      if (disposed || activeRequest === requestId) await closeAttemptedPreview(revision)
      if (!disposed && activeRequest === requestId) {
        preserveSandboxFailure(toFailure({
          draftId: args.payload.draftId,
          revision,
          reason: "transport-failed",
          message: errorMessage(error, "Could not reset Preview."),
        }))
      }
    }
  }

  const reset = () => {
    if (disposed) return Promise.resolve()
    return enqueueMutation(runReset)
  }

  void args.api.api.agent.events({}).then(async ([error, events]) => {
    if (error) throw new Error(errorMessage(error, "Preview updates disconnected."))
    const iterator = events[Symbol.asyncIterator]()
    if (disposed) {
      closeIterator(iterator)
      return
    }
    eventIterator = iterator
    while (!disposed) {
      const next = await iterator.next()
      if (next.done || disposed) break
      const event = next.value
      if (!("kind" in event) || !("draftId" in event) || event.draftId !== args.payload.draftId) continue
      if (event.kind === "widget-draft") {
        currentRevision = event.revision
        syncStatus(currentRevision !== ownedRevision, currentRevision !== ownedRevision ? "draft changed" : "Interactive Preview")
        continue
      }
      if (event.kind !== "widget-preview" || event.revision !== ownedRevision) continue
      const eventRequestId = requestId
      try {
        const result = await callPreviewGet()
        if (disposed || eventRequestId !== requestId || !result.ready || result.revision !== ownedRevision) continue
        currentReady = result
        currentRevision = result.currentRevision
        const actorMessage = actorErrorMessage(result.snapshot)
        syncStatus(result.stale, actorMessage ? "actor error" : "Interactive Preview")
        if (actorMessage) {
          renderSandboxError({
            phase: "sandbox-runtime",
            code: "DRAFT_PREVIEW_ACTOR_ERROR",
            message: actorMessage,
            retryable: true,
          })
        } else {
          body.querySelector(".vc-draft-preview__sandbox-error")?.remove()
        }
        emitSnapshot(result.snapshot)
      } catch (error) {
        if (!disposed && eventRequestId === requestId) renderSandboxError({
          phase: "snapshot",
          code: "DRAFT_PREVIEW_REFETCH_FAILED",
          message: errorMessage(error, "Could not refresh Preview state."),
          retryable: true,
        })
      }
    }
  }).catch((error) => {
    if (!disposed) {
      args.onLogError(error)
    }
  })

  if (args.initialResult) {
    if (args.initialResult.ready) {
      renderReady(args.initialResult, false)
    } else {
      if (args.initialResult.currentRevision) currentRevision = args.initialResult.currentRevision
      renderFailure(args.initialResult)
    }
  } else {
    void enqueueMutation(initialize)
  }

  const dispose = () => {
    if (disposalPromise) return disposalPromise
    disposed = true
    requestId += 1
    cleanupSandbox?.()
    cleanupSandbox = undefined
    snapshotSubscribers.clear()
    const iterator = eventIterator
    eventIterator = undefined
    closeIterator(iterator)
    args.onReleaseRevision(ownedRevision)
    disposalPromise = Promise.allSettled([...activeOperations]).then(() => undefined)
    return disposalPromise
  }

  return {
    refresh,
    reset,
    dispose,
    getOwnedRevision: () => ownedRevision,
  }
}
