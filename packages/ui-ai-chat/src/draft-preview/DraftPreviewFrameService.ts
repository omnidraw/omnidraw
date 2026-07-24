import type { IService, IStoppableService } from "@vibecanvas/runtime"
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types"
import type {
  CrdtService,
  HistoryService,
  RenderOrderService,
  SelectionService,
  ToolService,
  TWidgetWorldBounds,
} from "@vibecanvas/canvas/services"
import type { TAiChatApiPort, TAiChatApplicationPort, TWidgetBrowserPort } from "../ports"
import { widgetUiArtifactMount } from "../widget-runtime"
import type { TWidgetTitleBarPortal } from "../widget/interface"
import { mountWidgetPublicationDialog } from "../publication/mount"
import type { TWidgetPublicationApi } from "../publication/interface"
import {
  DRAFT_PREVIEW_FRAME_GAP,
  DRAFT_PREVIEW_MIN_HEIGHT,
  DRAFT_PREVIEW_MIN_WIDTH,
  DRAFT_PREVIEW_WIDGET_KIND,
} from "./CONSTANTS"
import { fnDraftPreviewElementId } from "./fn.element-id"
import { mountDraftPreview } from "./mount"
import type {
  TDraftPreviewPayload,
  TDraftPreviewReady,
  TDraftPreviewRuntime,
  TDraftPreviewSummary,
} from "./typed"

type TDraftPreviewFrameServiceArgs = {
  api: TAiChatApiPort
  application: TAiChatApplicationPort
  browser: TWidgetBrowserPort
  crdt: CrdtService
  history?: HistoryService
  renderOrder: RenderOrderService
  selection: SelectionService
  tool: ToolService
}

type TDraftPreviewOpenArgs = {
  draftId?: string
  draftName: string
  originChatElementId: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error.trim()
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message.trim()
  }
  return fallback
}

export function getDraftPreviewPayload(element: TElement): TDraftPreviewPayload | undefined {
  if (element.data.type !== "ui-widget" || element.data.kind !== DRAFT_PREVIEW_WIDGET_KIND) return undefined
  const payload = element.data.payload
  const draftId = payload?.draftId
  const draftName = payload?.draftName
  const originChatElementId = payload?.originChatElementId
  if (typeof draftId !== "string" || !draftId.trim()) return undefined
  if (typeof draftName !== "string" || !draftName.trim()) return undefined
  if (originChatElementId !== undefined && (typeof originChatElementId !== "string" || !originChatElementId.trim())) return undefined
  return { draftId, draftName, ...(originChatElementId ? { originChatElementId } : {}) }
}

export class DraftPreviewFrameService implements IService, IStoppableService {
  readonly name = "draft-preview-frame"
  readonly #args: TDraftPreviewFrameServiceArgs
  readonly #initialResults = new Map<string, TDraftPreviewReady>()
  readonly #runtimes = new Map<string, TDraftPreviewRuntime>()
  readonly #frameQueues = new Map<string, Promise<unknown>>()
  readonly #framePromises = new Set<Promise<unknown>>()
  #stopping = false

  constructor(args: TDraftPreviewFrameServiceArgs) {
    this.#args = args
  }

  async stop() {
    this.#stopping = true
    this.#initialResults.clear()
    const runtimeDisposals = [...this.#runtimes.values()].map((runtime) => runtime.dispose())
    this.#runtimes.clear()
    await Promise.allSettled([...this.#framePromises, ...runtimeDisposals])
  }

  getTitle(element: TElement) {
    const payload = getDraftPreviewPayload(element)
    return payload ? `${payload.draftName} Preview` : "Draft Preview"
  }

  mount(args: { root: HTMLDivElement; element: TElement; titleBar?: TWidgetTitleBarPortal }) {
    if (this.#stopping) {
      args.root.replaceChildren()
      return () => args.root.replaceChildren()
    }
    const payload = getDraftPreviewPayload(args.element)
    if (!payload) {
      const error = args.root.ownerDocument.createElement("div")
      error.setAttribute("role", "alert")
      error.style.padding = "20px"
      error.style.color = "var(--destructive, #b42318)"
      error.textContent = "This draft Preview frame has an invalid persisted payload."
      args.root.replaceChildren(error)
      return () => args.root.replaceChildren()
    }
    const previousRuntime = this.#runtimes.get(args.element.id)
    if (previousRuntime) void previousRuntime.dispose().catch(this.#args.application.logError)
    const runtime = mountDraftPreview({
      root: args.root,
      api: this.#args.api,
      browser: this.#args.browser,
      payload,
      initialResult: this.#initialResults.get(args.element.id),
      mountArtifact: widgetUiArtifactMount,
      onResetStateChange: (state) => args.titleBar?.setActionState("reset", state),
      onLogError: this.#args.application.logError,
    })
    this.#initialResults.delete(args.element.id)
    this.#runtimes.set(args.element.id, runtime)
    const disposeReset = args.titleBar?.onAction("reset", () => {
      void runtime.reset().catch(this.#args.application.logError)
    }) ?? (() => undefined)
    const publicationApi = this.#args.api.api.agent as unknown as Partial<TWidgetPublicationApi>
    const disposePublication = args.titleBar
      && publicationApi.widgets?.detail
      && publicationApi.widgetPublish?.publish
      ? mountWidgetPublicationDialog({
        document: args.root.ownerDocument,
        api: publicationApi as TWidgetPublicationApi,
        draftId: payload.draftId,
        draftName: payload.draftName,
        getPinnedRevision: () => runtime.getCurrentRevision(),
        titleBar: args.titleBar,
        onRequestPreviewRefresh: () => runtime.refresh(),
        onPublished: async () => {
          this.#args.application.invalidateWidgetCatalog?.()
          await runtime.refresh()
        },
      })
      : () => undefined

    return () => {
      disposeReset()
      disposePublication()
      if (this.#runtimes.get(args.element.id) === runtime) this.#runtimes.delete(args.element.id)
      void runtime.dispose().catch(this.#args.application.logError)
      args.root.replaceChildren()
    }
  }

  open(args: TDraftPreviewOpenArgs) {
    if (this.#stopping) return Promise.reject(new Error("Draft Preview opening was cancelled because the canvas is stopping."))
    return this.#queueFrame(args.draftId ?? `name:${args.draftName}`, () => this.#open(args))
  }

  place(args: { draftId: string; expectedRevision: string; bounds: TWidgetWorldBounds }) {
    if (this.#stopping) return Promise.reject(new Error("Draft Preview placement was cancelled because the canvas is stopping."))
    return this.#queueFrame(`${args.draftId}:${this.#args.browser.createId()}`, () => this.#place(args))
  }

  async #place(args: { draftId: string; expectedRevision: string; bounds: TWidgetWorldBounds }) {
    this.#throwIfStopping()
    const result = await this.#preparePreview(args.draftId, args.expectedRevision)
    this.#throwIfStopping()
    const timestamp = this.#args.browser.now()
    const elementId = fnDraftPreviewElementId(result.draftId, this.#args.browser.createId())
    const element = this.#createElement({
      id: elementId,
      x: args.bounds.x,
      y: args.bounds.y,
      width: args.bounds.width,
      height: args.bounds.height,
      timestamp,
      payload: { draftId: result.draftId, draftName: result.name },
    })
    return this.#insertElement(element, result)
  }

  #queueFrame<TResult>(key: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.#frameQueues.get(key) ?? Promise.resolve()
    let queued!: Promise<TResult>
    queued = previous.catch(() => undefined).then(() => {
      this.#throwIfStopping()
      return operation()
    }).finally(() => {
      this.#framePromises.delete(queued)
      if (this.#frameQueues.get(key) === queued) this.#frameQueues.delete(key)
    })
    this.#frameQueues.set(key, queued)
    this.#framePromises.add(queued)
    return queued
  }

  async #open(args: TDraftPreviewOpenArgs) {
    const summary = await this.#resolveDraft(args)
    this.#throwIfStopping()
    const existing = this.#findFrame(summary.draftId)
    if (existing) {
      this.#focusElement(existing.id)
      const runtime = this.#runtimes.get(existing.id)
      if (runtime) await runtime.refresh(summary)
      return
    }
    const origin = this.#args.crdt.doc().elements[args.originChatElementId]
    if (!origin || origin.data.type !== "ui-widget") throw new Error("The originating AI Chat frame is no longer available.")
    const result = await this.#preparePreview(summary.draftId, summary.revision)
    this.#throwIfStopping()
    const originBounds = this.#getOriginWorldBounds(origin)
    const timestamp = this.#args.browser.now()
    const element = this.#createElement({
      id: fnDraftPreviewElementId(summary.draftId),
      x: originBounds.x + originBounds.width + DRAFT_PREVIEW_FRAME_GAP,
      y: originBounds.y,
      width: Math.max(DRAFT_PREVIEW_MIN_WIDTH, originBounds.width),
      height: Math.max(DRAFT_PREVIEW_MIN_HEIGHT, originBounds.height),
      timestamp,
      payload: {
        draftId: summary.draftId,
        draftName: result.name,
        originChatElementId: args.originChatElementId,
      },
    })
    await this.#insertElement(element, result)
  }

  #createElement(args: Readonly<{
    id: string; x: number; y: number; width: number; height: number; timestamp: number; payload: TDraftPreviewPayload
  }>): TElement {
    return {
      id: args.id,
      x: args.x,
      y: args.y,
      rotation: 0,
      zIndex: "",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: args.timestamp,
      updatedAt: args.timestamp,
      data: {
        type: "ui-widget",
        kind: DRAFT_PREVIEW_WIDGET_KIND,
        w: args.width,
        h: args.height,
        expanded: true,
        window: "contained",
        payload: args.payload,
      },
      style: {},
    }
  }

  async #insertElement(element: TElement, result: TDraftPreviewReady) {
    this.#initialResults.set(element.id, result)
    try {
      const siblings = this.#args.renderOrder.getOrderedSiblings(null)
      const nextOrder = siblings.reduce((maximum, item) => {
        const match = /^z(\d+)$/.exec(item.zIndex)
        return match ? Math.max(maximum, Number.parseInt(match[1]!, 10) + 1) : maximum
      }, siblings.length)
      const persisted = {
        ...element,
        zIndex: `z${String(nextOrder).padStart(8, "0")}`,
      }
      const commitResult = this.#args.crdt.build().patchElement(persisted.id, persisted).commit()
      this.#focusElement(persisted.id)
      this.#recordCreateHistory(persisted, commitResult)
      return persisted
    } catch (error) {
      this.#initialResults.delete(element.id)
      throw error
    }
  }

  async #resolveDraft(args: Pick<TDraftPreviewOpenArgs, "draftId" | "draftName">): Promise<TDraftPreviewSummary> {
    if (args.draftId) return this.#getDraft(args.draftId)
    const [listError, summaries] = await this.#args.api.api.agent.widgetDraft.list({})
    if (listError) throw new Error(getErrorMessage(listError, "Could not list widget drafts."))
    const matches = summaries.filter((summary) => summary.name === args.draftName)
    if (matches.length !== 1) throw new Error(matches.length === 0
      ? `Widget draft '${args.draftName}' was not found.`
      : `Widget draft name '${args.draftName}' is ambiguous.`)
    return this.#getDraft(matches[0]!.draftId)
  }

  async #getDraft(draftId: string): Promise<TDraftPreviewSummary> {
    const [error, summary] = await this.#args.api.api.agent.widgetDraft.get({ draftId })
    if (error) throw new Error(getErrorMessage(error, "Could not read the widget draft."))
    if (!summary) throw new Error(`Widget draft '${draftId}' was not found.`)
    return summary
  }

  async #preparePreview(draftId: string, expectedRevision: string): Promise<TDraftPreviewReady> {
    const [error, result] = await this.#args.api.api.agent.widgetPreview.build({ draftId })
    if (error) throw new Error(getErrorMessage(error, "Could not build Preview."))
    if (!result) throw new Error("Preview build returned no result.")
    if (!result.ready) throw new Error(result.message || "Preview build failed.")
    if (result.draftId !== draftId || result.revision !== expectedRevision) {
      throw new Error("The widget draft changed before Preview placement.")
    }
    return result
  }

  #findFrame(draftId: string) {
    return Object.values(this.#args.crdt.doc().elements).find((element) => getDraftPreviewPayload(element)?.draftId === draftId)
  }

  #getOriginWorldBounds(origin: TElement) {
    if (origin.data.type !== "ui-widget" && origin.data.type !== "widget-instance") {
      throw new Error("The originating AI Chat frame does not have widget bounds.")
    }
    const bounds = {
      x: origin.x,
      y: origin.y,
      width: origin.data.w,
      height: origin.data.h,
    }
    if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("The originating AI Chat frame does not have usable canvas bounds.")
    }
    return bounds
  }

  #throwIfStopping() {
    if (this.#stopping) throw new Error("Draft Preview opening was cancelled because the canvas is stopping.")
  }

  #focusElement(elementId: string) {
    const target = { kind: "element", id: elementId } as const
    this.#args.tool.setActiveTool("select")
    this.#args.selection.setSelection([target])
    this.#args.selection.setFocusedTarget(target)
  }

  #recordCreateHistory(element: TElement, commitResult: ReturnType<ReturnType<CrdtService["build"]>["commit"]>) {
    if (!this.#args.history) return
    this.#args.history.record({
      label: "create-draft-preview",
      undo: () => {
        commitResult.rollback()
        this.#args.selection.pruneDocument(this.#args.crdt.doc())
      },
      redo: () => {
        this.#args.crdt.applyOps({ ops: commitResult.redoOps })
        this.#focusElement(element.id)
      },
    })
  }
}
