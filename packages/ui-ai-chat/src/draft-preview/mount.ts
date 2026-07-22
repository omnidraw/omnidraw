import { fxDecodeAndVerifyUiArtifact } from "../widget-runtime/fx.decode-and-verify-ui-artifact"
import type {
  TWidgetPreviewRuntimeIdentity,
  TVerifiedWidgetUiArtifact,
} from "../widget-runtime/interface"
import { createEphemeralCollaborativeStateBridge } from "./create-ephemeral-collaborative-state-bridge"
import { createPreviewFunctionHostBridge } from "./create-preview-function-host-bridge"
import type {
  TDraftPreviewFailure,
  TDraftPreviewOwnership,
  TDraftPreviewReady,
  TDraftPreviewResult,
  TDraftPreviewRuntime,
  TDraftPreviewSummary,
  TMountDraftPreviewArgs,
} from "./typed"
import "./widget.css"

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return error.trim()
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return fallback
}

function toFailure(args: Readonly<{
  draftId: string
  revision?: string
  previewId?: string
  previewRevisionId?: string
  reason: "transport-failed" | "artifact-invalid"
  message: string
}>): TDraftPreviewFailure {
  return {
    ready: false,
    draftId: args.draftId,
    ...(args.revision ? { revision: args.revision } : {}),
    ...(args.previewId ? { previewId: args.previewId } : {}),
    ...(args.previewRevisionId ? { previewRevisionId: args.previewRevisionId } : {}),
    reason: args.reason,
    message: args.message,
    diagnostics: [],
  }
}

function ownership(result: TDraftPreviewReady): TDraftPreviewOwnership {
  return {
    draftRevision: result.revision,
    previewRevisionId: result.previewRevisionId,
  }
}

function ownershipKey(candidate: TDraftPreviewOwnership): string {
  return `${candidate.draftRevision}\u0000${candidate.previewRevisionId}`
}

export function mountDraftPreview(args: TMountDraftPreviewArgs): TDraftPreviewRuntime {
  const dom = args.root.ownerDocument
  const shell = dom.createElement("section")
  const body = dom.createElement("div")
  let disposed = false
  let requestId = 0
  let owned: TDraftPreviewOwnership = {
    draftRevision: args.payload.draftRevision,
    previewRevisionId: args.payload.previewRevisionId,
  }
  let authorityPreviewRevisionId = owned.previewRevisionId
  let currentReady: TDraftPreviewReady | undefined
  let currentArtifact: TVerifiedWidgetUiArtifact | undefined
  let cleanupMounted: (() => void) | undefined
  let disposalPromise: Promise<void> | undefined
  let mutationTail: Promise<void> | undefined
  const activeOperations = new Set<Promise<unknown>>()
  const releasedOwnership = new Set<string>()

  shell.className = "vc-draft-preview"
  shell.setAttribute("aria-label", `${args.payload.draftName} Preview`)
  body.className = "vc-draft-preview__body"
  shell.append(body)
  args.root.replaceChildren(shell)

  const trackOperation = <T>(operation: Promise<T>): Promise<T> => {
    activeOperations.add(operation)
    void operation.then(
      () => activeOperations.delete(operation),
      () => activeOperations.delete(operation),
    )
    return operation
  }

  const enqueueMutation = (operation: () => Promise<void>): Promise<void> => {
    if (disposed) return Promise.resolve()
    const queued = (mutationTail ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => disposed ? undefined : operation())
    const tail = queued.catch(() => undefined)
    mutationTail = tail
    void tail.finally(() => {
      if (mutationTail === tail) mutationTail = undefined
    })
    return trackOperation(queued)
  }

  const release = (candidate: TDraftPreviewOwnership) => {
    const key = ownershipKey(candidate)
    if (releasedOwnership.has(key)) return
    releasedOwnership.add(key)
    args.onReleaseOwnership(candidate)
  }

  const clearMount = () => {
    cleanupMounted?.()
    cleanupMounted = undefined
    currentReady = undefined
    currentArtifact = undefined
  }

  const setBusy = (message: string) => {
    clearMount()
    body.replaceChildren()
    const loading = dom.createElement("div")
    loading.className = "vc-draft-preview__state vc-draft-preview__state--loading"
    loading.setAttribute("role", "status")
    loading.setAttribute("aria-live", "polite")
    loading.textContent = message
    body.appendChild(loading)
    args.onResetStateChange?.({ disabled: true })
  }

  const removeOverlay = () => body.querySelector(".vc-draft-preview__sandbox-error")?.remove()

  const renderOverlay = (message: string) => {
    removeOverlay()
    const overlay = dom.createElement("div")
    const heading = dom.createElement("strong")
    const detail = dom.createElement("p")
    overlay.className = "vc-draft-preview__sandbox-error"
    overlay.setAttribute("role", "alert")
    heading.textContent = "Preview could not update"
    detail.textContent = message
    overlay.append(heading, detail)
    body.appendChild(overlay)
  }

  const renderFailure = (failure: TDraftPreviewFailure) => {
    clearMount()
    body.replaceChildren()
    const state = dom.createElement("div")
    const heading = dom.createElement("strong")
    const message = dom.createElement("p")
    state.className = "vc-draft-preview__state vc-draft-preview__state--error"
    state.setAttribute("role", "alert")
    heading.textContent = failure.reason === "stale-revision"
      || failure.reason === "preview-conflict"
      ? "Preview revision is stale"
      : "Preview could not load"
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
    args.onResetStateChange?.({ disabled: true })
  }

  const wait = (timeoutMs: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Draft Preview function wait was cancelled."))
      return
    }
    const timer = args.browser.setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, timeoutMs)
    const onAbort = () => {
      args.browser.clearTimeout(timer)
      reject(new Error("Draft Preview function wait was cancelled."))
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })

  const assertReadyOwnership = (result: TDraftPreviewReady) => {
    if (result.draftId !== args.payload.draftId || result.previewId !== args.payload.previewId) {
      throw new Error("Draft Preview response owner mismatch.")
    }
  }

  const readyMatchesOwnedAuthority = (result: TDraftPreviewReady | undefined): boolean => (
    result !== undefined
    && result.revision === owned.draftRevision
    && result.previewRevisionId === owned.previewRevisionId
    && authorityPreviewRevisionId === owned.previewRevisionId
  )

  const mountVerified = (
    result: TDraftPreviewReady,
    artifact: TVerifiedWidgetUiArtifact,
    persist: boolean,
  ) => {
    assertReadyOwnership(result)
    const identity: TWidgetPreviewRuntimeIdentity = Object.freeze({
      kind: "agent_preview",
      definitionId: result.definitionId,
      previewId: result.previewId,
      previewRevisionId: result.previewRevisionId,
    })
    const previousAuthority = authorityPreviewRevisionId
    authorityPreviewRevisionId = result.previewRevisionId
    const functionBridge = createPreviewFunctionHostBridge({
      api: args.api,
      draftId: result.draftId,
      identity,
      functionDescriptors: result.contract.functions,
      createId: args.browser.createId,
      nowMs: args.browser.now,
      wait,
      isCurrent: () => !disposed && authorityPreviewRevisionId === result.previewRevisionId,
      onLogError: args.onLogError,
    })
    const collaborativeStateBridge = createEphemeralCollaborativeStateBridge()
    const nextRoot = dom.createElement("div")
    nextRoot.className = "vc-draft-preview__sandbox"
    let cleanupArtifact: (() => void) | undefined
    try {
      cleanupArtifact = args.mountArtifact.mount({
        root: nextRoot,
        identity,
        artifact,
        functionBridge,
        collaborativeStateBridge,
        onFatal(error) {
          if (disposed || authorityPreviewRevisionId !== result.previewRevisionId) return
          args.onLogError(error)
          renderOverlay(errorMessage(error, "Preview runtime failed."))
        },
      })
    } catch (error) {
      authorityPreviewRevisionId = previousAuthority
      functionBridge.dispose()
      collaborativeStateBridge.dispose()
      throw error
    }
    if (disposed) {
      cleanupArtifact()
      release(ownership(result))
      return
    }
    cleanupMounted?.()
    cleanupMounted = () => {
      cleanupArtifact?.()
      functionBridge.dispose()
      collaborativeStateBridge.dispose()
    }
    currentReady = result
    currentArtifact = artifact
    const nextOwnership = ownership(result)
    const changed = ownershipKey(nextOwnership) !== ownershipKey(owned)
    owned = nextOwnership
    authorityPreviewRevisionId = nextOwnership.previewRevisionId
    body.replaceChildren(nextRoot)
    args.onResetStateChange?.({ disabled: false })
    if (persist && changed) args.onPersistOwnership(nextOwnership)
  }

  const verifyAndMount = async (
    result: TDraftPreviewReady,
    persist: boolean,
    activeRequest: number,
  ) => {
    assertReadyOwnership(result)
    const encodedBytes = args.browser.decodeBase64(result.uiArtifact.bytesBase64)
    if (encodedBytes.byteLength !== result.uiArtifact.byteSize) {
      throw new Error("Widget UI artifact byte size mismatch.")
    }
    const artifact = await fxDecodeAndVerifyUiArtifact({ codec: args.browser }, {
      expectedDigestSha256: result.uiArtifact.digestSha256,
      bytesBase64: result.uiArtifact.bytesBase64,
    })
    if (disposed || activeRequest !== requestId) {
      release(ownership(result))
      return
    }
    mountVerified(result, artifact, persist)
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
      previewId: args.payload.previewId,
    })
    if (error) throw new Error(errorMessage(error, "Could not read Preview state."))
    if (!result) throw new Error("Preview state was unavailable.")
    return result
  }

  const reconcileAfterBuildAttempt = async (
    failure: TDraftPreviewFailure,
    activeRequest: number,
  ) => {
    // Once the build RPC has been sent, transport failure is commit-ambiguous.
    // Fence cached authority until an exact active revision is re-read.
    authorityPreviewRevisionId = ""
    const active = await callPreviewGet()
    if (disposed || activeRequest !== requestId) {
      // This revision was only observed; this frame did not create or adopt
      // it, so cleanup remains with its current owner.
      return
    }
    if (!active.ready) {
      if (currentReady) renderOverlay(failure.message)
      else renderFailure(failure)
      return
    }
    const activeOwnership = ownership(active)
    const mountedActive = currentReady !== undefined
      && currentArtifact !== undefined
      && ownershipKey(ownership(currentReady)) === ownershipKey(activeOwnership)
    if (ownershipKey(activeOwnership) !== ownershipKey(owned)) {
      owned = activeOwnership
      args.onPersistOwnership(activeOwnership)
    }
    authorityPreviewRevisionId = activeOwnership.previewRevisionId
    if (mountedActive) {
      renderOverlay(failure.message)
      return
    }
    await verifyAndMount(active, false, activeRequest)
  }

  const initialize = async () => {
    const activeRequest = ++requestId
    setBusy("Loading Preview…")
    try {
      const result = args.initialResult ?? await callPreviewGet()
      if (disposed || activeRequest !== requestId) {
        if (result.ready) release(ownership(result))
        return
      }
      if (
        !result.ready
        || result.previewRevisionId !== owned.previewRevisionId
        || result.revision !== owned.draftRevision
      ) {
        renderFailure(result.ready ? {
          ready: false,
          draftId: args.payload.draftId,
          revision: owned.draftRevision,
          previewId: args.payload.previewId,
          previewRevisionId: owned.previewRevisionId,
          reason: "stale-revision",
          message: "The persisted Preview revision is no longer active. Refresh it from the draft.",
          diagnostics: [],
        } : result)
        return
      }
      await verifyAndMount(result, false, activeRequest)
    } catch (error) {
      if (disposed || activeRequest !== requestId) return
      args.onLogError(error)
      renderFailure(toFailure({
        draftId: args.payload.draftId,
        revision: owned.draftRevision,
        previewId: args.payload.previewId,
        previewRevisionId: owned.previewRevisionId,
        reason: errorMessage(error, "").includes("artifact") ? "artifact-invalid" : "transport-failed",
        message: errorMessage(error, "Could not load Preview."),
      }))
    }
  }

  const runRefresh = async (providedSummary?: TDraftPreviewSummary) => {
    const activeRequest = ++requestId
    let buildRequested = false
    let reconciliationAttempted = false
    args.onResetStateChange?.({ disabled: true })
    try {
      const summary = providedSummary ?? await callDraftGet()
      if (disposed || activeRequest !== requestId) return
      buildRequested = true
      const [error, built] = await args.api.api.agent.widgetPreview.build({
        draftId: args.payload.draftId,
        previewId: args.payload.previewId,
        expectedDraftRevision: summary.revision,
        expectedActivePreviewRevisionId: owned.previewRevisionId,
      })
      if (error) throw new Error(errorMessage(error, "Could not build Preview."))
      if (!built) throw new Error("Preview build returned no result.")
      const result: TDraftPreviewResult = built
      if (disposed || activeRequest !== requestId) {
        if (result.ready) release(ownership(result))
        return
      }
      if (!result.ready) {
        reconciliationAttempted = true
        await reconcileAfterBuildAttempt(result, activeRequest)
        return
      }
      if (result.revision !== summary.revision) {
        release(ownership(result))
        throw new Error("Preview build returned a different draft revision.")
      }
      // The server CAS has already made this exact Preview revision
      // authoritative. Persist/adopt that ownership before any fallible local
      // decode or mount work so a bad artifact cannot leave the frame pointing
      // at the now-inactive previous revision. The old UI may remain visible
      // behind an error overlay, but its function bridge is fenced immediately
      // and the next refresh replaces the newly adopted authority.
      const nextOwnership = ownership(result)
      if (ownershipKey(nextOwnership) !== ownershipKey(owned)) {
        owned = nextOwnership
        authorityPreviewRevisionId = nextOwnership.previewRevisionId
        args.onPersistOwnership(nextOwnership)
      }
      await verifyAndMount(result, false, activeRequest)
    } catch (error) {
      if (disposed || activeRequest !== requestId) return
      args.onLogError(error)
      const message = errorMessage(error, "Could not refresh Preview.")
      const failure = toFailure({
        draftId: args.payload.draftId,
        revision: owned.draftRevision,
        previewId: args.payload.previewId,
        previewRevisionId: owned.previewRevisionId,
        reason: message.includes("artifact") ? "artifact-invalid" : "transport-failed",
        message,
      })
      if (buildRequested && !reconciliationAttempted) {
        reconciliationAttempted = true
        try {
          await reconcileAfterBuildAttempt(failure, activeRequest)
          return
        } catch (reconcileError) {
          if (disposed || activeRequest !== requestId) return
          args.onLogError(reconcileError)
        }
      }
      if (currentReady) renderOverlay(message)
      else renderFailure(failure)
    } finally {
      if (!disposed && activeRequest === requestId) {
        args.onResetStateChange?.({ disabled: !readyMatchesOwnedAuthority(currentReady) })
      }
    }
  }

  const runReset = async () => {
    const activeRequest = ++requestId
    const ready = currentReady
    const artifact = currentArtifact
    if (!ready || !artifact || !readyMatchesOwnedAuthority(ready)) {
      args.onResetStateChange?.({ disabled: true })
      return
    }
    args.onResetStateChange?.({ disabled: true })
    try {
      if (disposed || activeRequest !== requestId) return
      mountVerified(ready, artifact, false)
    } catch (error) {
      if (disposed || activeRequest !== requestId) return
      args.onLogError(error)
      renderOverlay(errorMessage(error, "Could not reset Preview locally."))
    } finally {
      if (!disposed && activeRequest === requestId) args.onResetStateChange?.({ disabled: false })
    }
  }

  trackOperation(initialize()).catch(() => undefined)

  return {
    refresh: (summary) => enqueueMutation(() => runRefresh(summary)),
    reset: () => enqueueMutation(runReset),
    dispose() {
      if (disposalPromise) return disposalPromise
      disposed = true
      requestId += 1
      clearMount()
      args.root.replaceChildren()
      disposalPromise = (async () => {
        await Promise.allSettled([...activeOperations])
        release(owned)
      })()
      return disposalPromise
    },
    getOwnedRevision: () => owned.draftRevision,
    getOwnedPreviewRevisionId: () => owned.previewRevisionId,
  }
}
