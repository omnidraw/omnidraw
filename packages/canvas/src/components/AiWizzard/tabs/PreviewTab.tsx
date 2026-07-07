import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import type { TActorData, TActorState } from "@vibecanvas/service-actor/core/types"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import { html as HTML } from "@arrow-js/core"
import { sandbox as SANDBOX } from "@arrow-js/sandbox"
import { Dialog } from "@kobalte/core/dialog"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import SDK_WIDGET_SOURCE from "../../../../../sdk/dist/widget.js?raw"

interface IProps {
  apiService: TOrpcSafeClient
  sessionId: string
  widgetId: string
}

type TWidgetHostActorEventResult =
  | { readonly cursor?: string; readonly type: "snapshot"; readonly snapshot: TAgentDraftActorSnapshot }
  | { readonly cursor?: string; readonly type: "noop" }

type TAgentDraftActorSnapshot = {
  state: TActorState
  context: TActorData
}

type TWidgetActorMessageAction = {
  name: string
  payload: unknown
}

const SDK_MODULE_PATH = "/__vibecanvas_sdk.js"
const SDK_BOOTSTRAP_MODULE_PATH = "/__vibecanvas_sdk_bootstrap.js"
const SDK_HOST_BRIDGE_MODULE = "host-bridge:vibecanvas-widget"
const SANDBOX_EVENT_COMPAT_SOURCE = `
(() => {
  const noop = () => undefined;
  for (const name of ['preventDefault', 'stopPropagation', 'stopImmediatePropagation', 'reset']) {
    if (name in Object.prototype) continue;
    Object.defineProperty(Object.prototype, name, {
      configurable: true,
      value: noop,
    });
  }
})();
`
const SDK_BOOTSTRAP_SOURCE = `
${SANDBOX_EVENT_COMPAT_SOURCE}
import { __setActorSnapshot, __setSendMessage } from '${SDK_MODULE_PATH}';
import { getActorSnapshot, sendActorMessage, nextActorEvent } from '${SDK_HOST_BRIDGE_MODULE}';

let cursor;

__setSendMessage(async (name, payload) => {
  const result = await sendActorMessage({ name, payload });
  if (!result || result.ok !== true) {
    throw new Error(result?.message || 'Widget actor message failed');
  }
});

void getActorSnapshot().then(__setActorSnapshot);

async function pollActorEvents() {
  while (true) {
    const event = await nextActorEvent({ cursor });
    if (!event || event.type === 'noop') continue;
    cursor = event.cursor ?? cursor;
    if (event.type === 'snapshot') __setActorSnapshot(event.snapshot);
  }
}

void pollActorEvents();

export { actor } from '${SDK_MODULE_PATH}';
`
const SANDBOX_BASE_CSS = `
:host {
  display: block;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  box-sizing: border-box;
}

*, *::before, *::after {
  box-sizing: border-box;
}
`

function getCursorFromBridgeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined
  if (!("cursor" in args)) return undefined
  return typeof args.cursor === "string" ? args.cursor : undefined
}

function getActorMessageFromBridgeArgs(args: unknown): TWidgetActorMessageAction | null {
  if (!args || typeof args !== "object") return null
  if (!("name" in args) || typeof args.name !== "string") return null
  if (!("payload" in args)) return null

  return {
    name: args.name,
    payload: args.payload,
  }
}

function getSandboxSource(source: Record<string, string | undefined>): Record<string, string> {
  const nextSource: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(source).flatMap(([path, fileSource]) => {
        if (fileSource === undefined) return []
        const sourceWithSdkBootstrap = fileSource.replaceAll("@vibecanvas/sdk/widget", SDK_BOOTSTRAP_MODULE_PATH)
        const nextFileSource = path === "main.ts" || path === "main.js"
          ? `${SANDBOX_EVENT_COMPAT_SOURCE}\n${sourceWithSdkBootstrap}`
          : sourceWithSdkBootstrap
        return [[path, nextFileSource]]
      }),
    ),
    [SDK_MODULE_PATH]: SDK_WIDGET_SOURCE,
    [SDK_BOOTSTRAP_MODULE_PATH]: SDK_BOOTSTRAP_SOURCE,
  }

  nextSource["main.css"] = `${SANDBOX_BASE_CSS}\n${nextSource["main.css"] ?? ""}`

  return nextSource
}

function normalizePathPart(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "")
}

function getPreviewSandboxSource(source: Record<string, string>, relWidgetDir: string): Record<string, string> {
  const widgetDir = normalizePathPart(relWidgetDir)
  const widgetDirPrefix = widgetDir.length > 0 ? `${widgetDir}/` : ""
  const nextSource: Record<string, string> = {}

  for (const [path, fileSource] of Object.entries(source)) {
    const normalizedPath = normalizePathPart(path)
    const sandboxPath = widgetDirPrefix.length > 0 && normalizedPath.startsWith(widgetDirPrefix)
      ? normalizedPath.slice(widgetDirPrefix.length)
      : normalizedPath

    nextSource[sandboxPath] = fileSource
  }

  return nextSource
}

function hasPreviewEntrySource(source: Record<string, string>): boolean {
  return Boolean(source["main.ts"] || source["main.js"])
}

function preventDefault(event: Event) {
  event.preventDefault()
}

function bindSandboxFormSubmitGuards(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = []
  const sandboxHosts = Array.from(root.querySelectorAll("arrow-sandbox"))

  for (const sandboxHost of sandboxHosts) {
    let cleanupSubmitGuard: (() => void) | null = null

    const bindSubmitGuard = () => {
      cleanupSubmitGuard?.()

      const target = sandboxHost.shadowRoot ?? sandboxHost
      target.addEventListener("submit", preventDefault, { capture: true })
      cleanupSubmitGuard = () => target.removeEventListener("submit", preventDefault, { capture: true })
    }

    sandboxHost.addEventListener("sandbox-ready", bindSubmitGuard)
    bindSubmitGuard()

    cleanups.push(() => {
      sandboxHost.removeEventListener("sandbox-ready", bindSubmitGuard)
      cleanupSubmitGuard?.()
    })
  }

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}

export function PreviewTab(props: IProps) {
  let root: HTMLDivElement | undefined
  let disposeSandbox: (() => void) | undefined
  let unbindSandboxFormSubmitGuards: (() => void) | undefined
  let cursor = 0
  let currentSnapshot: TAgentDraftActorSnapshot | null = null
  const queuedEvents: TWidgetHostActorEventResult[] = []
  const pendingResolvers: Array<(event: TWidgetHostActorEventResult) => void> = []

  const [status, setStatus] = createSignal<"loading" | "ready" | "not-ready" | "error">("loading")
  const [message, setMessage] = createSignal("Loading draft preview.")
  const [isReloading, setIsReloading] = createSignal(false)
  const [isResetting, setIsResetting] = createSignal(false)
  const [isPublishDialogOpen, setIsPublishDialogOpen] = createSignal(false)
  const [isPublishing, setIsPublishing] = createSignal(false)
  const [publishMessage, setPublishMessage] = createSignal<string>()
  const [manifest, setManifest] = createSignal<TVibecanvasJson | null>(null)
  const [actorState, setActorState] = createSignal<string>("booting")
  const [sourceCount, setSourceCount] = createSignal(0)

  function resolvePending(event: TWidgetHostActorEventResult) {
    const resolve = pendingResolvers.shift()
    if (resolve) {
      resolve(event)
      return
    }

    queuedEvents.push(event)
  }

  function pushSnapshot(snapshot: TAgentDraftActorSnapshot) {
    currentSnapshot = snapshot
    setActorState(snapshot.state)
    cursor += 1
    resolvePending({ type: "snapshot", cursor: String(cursor), snapshot })
  }

  function disposeCurrentSandbox() {
    disposeSandbox?.()
    unbindSandboxFormSubmitGuards?.()
    disposeSandbox = undefined
    unbindSandboxFormSubmitGuards = undefined
    while (pendingResolvers.length > 0) {
      pendingResolvers.shift()?.({ type: "noop", cursor: String(cursor) })
    }
    queuedEvents.length = 0
    root?.replaceChildren()
  }

  async function loadPreview(mode: "start" | "reload" | "reset" = "start") {
    if (!root) return

    if (mode === "reload") setIsReloading(true)
    if (mode === "reset") setIsResetting(true)
    setStatus("loading")
    setMessage(mode === "start" ? "Loading draft preview." : mode === "reload" ? "Reloading draft files." : "Resetting draft actor.")

    try {
      const [sourceError, sourceResult] = await props.apiService.api.agent.wizzard.previewSource({
        widgetId: props.widgetId,
        sessionId: props.sessionId,
      })

      if (sourceError) throw new Error(sourceError.message)
      if (!sourceResult.ready) {
        disposeCurrentSandbox()
        setManifest(null)
        setStatus("not-ready")
        setMessage(sourceResult.message)
        setSourceCount(0)
        return
      }

      const sandboxSource = getPreviewSandboxSource(sourceResult.sources, sourceResult.manifest.widget.relWidgetDir)
      const sourceEntries = Object.keys(sandboxSource)
      if (sourceEntries.length === 0 || !hasPreviewEntrySource(sandboxSource)) {
        disposeCurrentSandbox()
        setManifest(sourceResult.manifest)
        setStatus("not-ready")
        setSourceCount(sourceEntries.length)
        setMessage(`Draft widget files are missing. Expected main.ts or main.js inside ${sourceResult.manifest.widget.relWidgetDir}. Found: ${sourceEntries.join(", ") || "none"}.`)
        return
      }

      const actorCall = mode === "reset"
        ? props.apiService.api.agent.wizzard.draftActor.reset
        : mode === "reload"
          ? props.apiService.api.agent.wizzard.draftActor.reload
          : props.apiService.api.agent.wizzard.draftActor.start
      const [actorError, actorResult] = await actorCall({
        widgetId: props.widgetId,
        sessionId: props.sessionId,
      })

      if (actorError) throw new Error(actorError.message)
      if (!actorResult.ready) {
        disposeCurrentSandbox()
        setManifest(sourceResult.manifest)
        setStatus("not-ready")
        setMessage(actorResult.message)
        setSourceCount(sourceEntries.length)
        return
      }

      disposeCurrentSandbox()
      pushSnapshot(actorResult.snapshot)
      setManifest(sourceResult.manifest)
      setSourceCount(sourceEntries.length)
      setStatus("ready")
      setMessage(`Previewing ${sourceResult.manifest.name}.`)

      HTML`<section class="ai-wizzard-preview-sandbox-shell">
        ${SANDBOX({
          source: getSandboxSource(sandboxSource),
        }, {
          output(payload) {
            setStatus("error")
            setMessage(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2))
          },
        }, {
          [SDK_HOST_BRIDGE_MODULE]: {
            async getActorSnapshot() {
              if (currentSnapshot) return currentSnapshot

              const [inspectError, inspectResult] = await props.apiService.api.agent.wizzard.draftActor.inspect({
                widgetId: props.widgetId,
                sessionId: props.sessionId,
              })

              if (inspectError) {
                return { state: "error", context: { message: inspectError.message } }
              }

              if (!inspectResult.ready) {
                return { state: "error", context: { message: inspectResult.message } }
              }

              currentSnapshot = inspectResult.snapshot
              return inspectResult.snapshot
            },
            async sendActorMessage(args: unknown) {
              const actorMessage = getActorMessageFromBridgeArgs(args)
              if (!actorMessage) {
                return {
                  ok: false,
                  code: "INVALID_WIDGET_MESSAGE",
                  message: "Widget actor message must be { name: string, payload: unknown }",
                }
              }

              const [sendError, sendResult] = await props.apiService.api.agent.wizzard.draftActor.send({
                widgetId: props.widgetId,
                sessionId: props.sessionId,
                name: actorMessage.name,
                payload: actorMessage.payload,
              })

              if (sendError) {
                return {
                  ok: false,
                  code: "DRAFT_ACTOR_SEND_FAILED",
                  message: sendError.message,
                }
              }

              if (!sendResult.ready) {
                return {
                  ok: false,
                  code: sendResult.reason,
                  message: sendResult.message,
                }
              }

              pushSnapshot(sendResult.snapshot)
              return { ok: true, messageId: sendResult.messageId }
            },
            nextActorEvent(args: unknown) {
              const requestedCursor = getCursorFromBridgeArgs(args)
              const queuedEvent = queuedEvents.shift()
              if (queuedEvent && queuedEvent.cursor !== requestedCursor) return queuedEvent
              if (queuedEvent) queuedEvents.unshift(queuedEvent)

              return new Promise<TWidgetHostActorEventResult>((resolve) => {
                pendingResolvers.push(resolve)
              })
            },
          },
        })}
      </section>`(root)

      unbindSandboxFormSubmitGuards = bindSandboxFormSubmitGuards(root)
    } catch (error) {
      disposeCurrentSandbox()
      setManifest(null)
      setStatus("error")
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsReloading(false)
      setIsResetting(false)
    }
  }

  createEffect(() => {
    const widgetId = props.widgetId
    const sessionId = props.sessionId
    let disposed = false

    void loadPreview("start")

    void props.apiService.api.agent.events({}).then(async ([err, events]) => {
      if (err) {
        if (!disposed) {
          setStatus("error")
          setMessage(err.message)
        }
        return
      }

      for await (const event of events) {
        if (disposed) break
        if (!("kind" in event) || event.kind !== "draft-actor") continue
        if (event.widgetId !== widgetId || event.sessionId !== sessionId) continue
        if (event.snapshot) pushSnapshot(event.snapshot as TAgentDraftActorSnapshot)
        if (event.event.kind === "system" && event.event.type === "error") {
          setStatus("error")
          setMessage(event.event.message)
        }
      }
    })

    onCleanup(() => {
      disposed = true
      disposeCurrentSandbox()
      void props.apiService.api.agent.wizzard.draftActor.stop({ widgetId, sessionId })
    })
  })

  const publish = async () => {
    if (isPublishing()) return

    setIsPublishing(true)
    setPublishMessage(undefined)

    const [error, result] = await props.apiService.api.agent.wizzard.publish({
      widgetId: props.widgetId,
      sessionId: props.sessionId,
    })

    setIsPublishing(false)

    if (error) {
      setPublishMessage(error.message)
      return
    }

    if (!result.published) {
      setPublishMessage(result.message)
      return
    }

    setPublishMessage(`Published ${result.manifest.name}. It is now available from the canvas tools.`)
    setStatus("ready")
    setMessage(`Published ${result.manifest.name}.`)
  }

  const toolLocation = () => {
    const currentManifest = manifest()
    const tool = currentManifest?.widget.tool
    if (!tool) return "the canvas tools"
    return tool.group ? `${tool.group} tools as "${tool.label}"` : `the canvas tools as "${tool.label}"`
  }

  return (
    <div class="ai-wizzard-tab ai-wizzard-tab--preview">
      <section class="ai-wizzard-preview-card ai-wizzard-preview-card--toolbar">
        <div class="ai-wizzard-preview-header">
          <div>
            <span>Draft preview</span>
            <strong>{actorState()}</strong>
          </div>
          <div class="ai-wizzard-preview-actions">
            <button type="button" class="ai-wizzard-secondary-button" disabled={isReloading() || isResetting()} onClick={() => void loadPreview("reload")}>
              {isReloading() ? "Reloading" : "Reload"}
            </button>
            <button type="button" class="ai-wizzard-secondary-button" disabled={isReloading() || isResetting()} onClick={() => void loadPreview("reset")}>
              {isResetting() ? "Resetting" : "Reset"}
            </button>
            <button type="button" class="ai-wizzard-primary-button ai-wizzard-primary-button--compact" disabled={status() !== "ready"} onClick={() => setIsPublishDialogOpen(true)}>
              Publish
            </button>
          </div>
        </div>
        <div class="ai-wizzard-preview-row">
          <span>{message()}</span>
          <span class="ai-wizzard-status" classList={{
            "ai-wizzard-status--good": status() === "ready",
            "ai-wizzard-status--bad": status() === "error",
          }}>{status()}</span>
        </div>
        <Show when={sourceCount() > 0}>
          <div class="ai-wizzard-preview-row">
            <span>Widget source files</span>
            <span>{sourceCount()}</span>
          </div>
        </Show>
      </section>
      <div class="ai-wizzard-preview-sandbox" ref={root} />
      <Dialog open={isPublishDialogOpen()} onOpenChange={setIsPublishDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay class="ai-wizzard-dialog-overlay" />
          <Dialog.Content class="ai-wizzard-dialog">
            <header class="ai-wizzard-dialog__header">
              <div>
                <Dialog.Title class="ai-wizzard-dialog__title">Publish widget</Dialog.Title>
                <Dialog.Description class="ai-wizzard-dialog__description">
                  Publish the current draft as a new canvas app.
                </Dialog.Description>
              </div>
              <Dialog.CloseButton class="ai-wizzard-dialog__close">Close</Dialog.CloseButton>
            </header>
            <div class="ai-wizzard-dialog__body">
              <p>
                The new app will be available in {toolLocation()}.
              </p>
              <p>
                Published apps get their own identity. To edit a published app later, open a new wizard for that app instead of continuing in this draft.
              </p>
              <Show when={publishMessage()}>
                {(currentMessage) => <pre class="ai-wizzard-dialog__message">{currentMessage()}</pre>}
              </Show>
            </div>
            <footer class="ai-wizzard-dialog__actions">
              <Dialog.CloseButton class="ai-wizzard-secondary-button">Cancel</Dialog.CloseButton>
              <button type="button" class="ai-wizzard-primary-button" disabled={isPublishing()} onClick={() => void publish()}>
                {isPublishing() ? "Publishing" : "Publish"}
              </button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </div>
  )
}
