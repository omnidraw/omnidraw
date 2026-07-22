import { fxDecodeAndVerifyUiArtifact } from "../widget-runtime/fx.decode-and-verify-ui-artifact"
import type {
  TWidgetFunctionHostBridge,
  TWidgetPreviewRuntimeIdentity,
  TVerifiedWidgetUiArtifact,
} from "../widget-runtime/interface"
import { createEphemeralCollaborativeStateBridge } from "./create-ephemeral-collaborative-state-bridge"
import type {
  TDraftPreviewFailure,
  TDraftPreviewReady,
  TDraftPreviewResult,
  TDraftPreviewRuntime,
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
  reason: "transport-failed" | "artifact-invalid"
  message: string
}>): TDraftPreviewFailure {
  return {
    ready: false,
    draftId: args.draftId,
    ...(args.revision ? { revision: args.revision } : {}),
    reason: args.reason,
    message: args.message,
    diagnostics: [],
  }
}

function createUnavailableFunctionBridge(
  identity: TWidgetPreviewRuntimeIdentity,
  createId: () => string,
): TWidgetFunctionHostBridge {
  return Object.freeze({
    identity,
    createIdempotencyKey: createId,
    async invoke(): Promise<never> {
      const error = new Error(
        "PREVIEW_FUNCTIONS_UNAVAILABLE: Server functions and resources become available after Publish.",
      )
      Object.assign(error, { code: "PREVIEW_FUNCTIONS_UNAVAILABLE" })
      throw error
    },
    dispose() {},
  })
}

export function mountDraftPreview(args: TMountDraftPreviewArgs): TDraftPreviewRuntime {
  const dom = args.root.ownerDocument
  const shell = dom.createElement("section")
  const body = dom.createElement("div")
  let disposed = false
  let requestId = 0
  let currentRevision = ""
  let currentReady: TDraftPreviewReady | undefined
  let currentArtifact: TVerifiedWidgetUiArtifact | undefined
  let cleanupMounted: (() => void) | undefined
  let activeOperation: Promise<void> = Promise.resolve()

  shell.className = "vc-draft-preview"
  shell.setAttribute("aria-label", `${args.payload.draftName} Preview`)
  body.className = "vc-draft-preview__body"
  shell.append(body)
  args.root.replaceChildren(shell)

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

  const renderFailure = (failure: TDraftPreviewFailure) => {
    clearMount()
    body.replaceChildren()
    const state = dom.createElement("div")
    const heading = dom.createElement("strong")
    const message = dom.createElement("p")
    state.className = "vc-draft-preview__state vc-draft-preview__state--error"
    state.setAttribute("role", "alert")
    heading.textContent = failure.reason === "not-found"
      ? "Draft is unavailable"
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

  const mountVerified = (result: TDraftPreviewReady, artifact: TVerifiedWidgetUiArtifact) => {
    const identity: TWidgetPreviewRuntimeIdentity = Object.freeze({
      kind: "draft_preview",
      draftId: result.draftId,
      definitionId: result.definitionId,
      revision: result.revision,
    })
    const functionBridge = createUnavailableFunctionBridge(identity, args.browser.createId)
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
          if (!disposed) args.onLogError(error)
        },
      })
    } catch (error) {
      functionBridge.dispose()
      collaborativeStateBridge.dispose()
      throw error
    }
    if (disposed) {
      cleanupArtifact()
      functionBridge.dispose()
      collaborativeStateBridge.dispose()
      return
    }
    clearMount()
    body.replaceChildren(nextRoot)
    currentRevision = result.revision
    currentReady = result
    currentArtifact = artifact
    cleanupMounted = () => {
      cleanupArtifact?.()
      functionBridge.dispose()
      collaborativeStateBridge.dispose()
    }
    args.onResetStateChange?.({ disabled: false })
  }

  const verifyAndMount = async (result: TDraftPreviewReady, activeRequest: number) => {
    const artifact = await fxDecodeAndVerifyUiArtifact({ codec: args.browser }, {
      expectedDigestSha256: result.uiArtifact.digestSha256,
      bytesBase64: result.uiArtifact.bytesBase64,
    })
    if (disposed || activeRequest !== requestId) return
    mountVerified(result, artifact)
  }

  const runBuild = async (initial?: TDraftPreviewResult) => {
    const activeRequest = ++requestId
    setBusy("Building current Preview…")
    try {
      let result = initial
      if (!result) {
        const [error, built] = await args.api.api.agent.widgetPreview.build({
          draftId: args.payload.draftId,
        })
        if (error) throw new Error(errorMessage(error, "Could not build Preview."))
        if (!built) throw new Error("Preview build returned no result.")
        result = built
      }
      if (disposed || activeRequest !== requestId) return
      if (result.draftId !== args.payload.draftId) {
        throw new Error("Preview build returned a different draft owner.")
      }
      if (!result.ready) {
        renderFailure(result)
        return
      }
      await verifyAndMount(result, activeRequest)
    } catch (error) {
      if (disposed || activeRequest !== requestId) return
      args.onLogError(error)
      const message = errorMessage(error, "Could not build Preview.")
      renderFailure(toFailure({
        draftId: args.payload.draftId,
        revision: currentRevision || undefined,
        reason: message.toLowerCase().includes("artifact") ? "artifact-invalid" : "transport-failed",
        message,
      }))
    }
  }

  const enqueueBuild = (initial?: TDraftPreviewResult) => {
    activeOperation = activeOperation.catch(() => undefined).then(() => runBuild(initial))
    return activeOperation
  }

  void enqueueBuild(args.initialResult)

  return {
    refresh: async () => enqueueBuild(),
    reset: async () => enqueueBuild(),
    dispose: async () => {
      if (disposed) return
      disposed = true
      requestId += 1
      await activeOperation.catch(() => undefined)
      clearMount()
      args.root.replaceChildren()
    },
    getCurrentRevision: () => currentRevision || currentReady?.revision || "",
  }
}
