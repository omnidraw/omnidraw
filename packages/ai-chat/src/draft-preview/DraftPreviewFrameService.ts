import type { IService, IStoppableService } from "@vibecanvas/runtime"
import type { TElement, TUiWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types"
import type {
  CrdtService,
  ElementService,
  HistoryService,
  RenderOrderService,
  SceneService,
  SelectionService,
  ToolService,
} from "@vibecanvas/canvas/services"
import { ELEMENT_DATA_ATTR, VC_ON_REMOVE_ATTR } from "@vibecanvas/canvas/core/CONSTANTS"
import { isKonvaGroup } from "@vibecanvas/canvas/core/GUARDS"
import Konva from "konva"
import type { TAiChatApiPort, TAiChatApplicationPort, TWidgetBrowserPort } from "../ports"
import { mountArrowSandboxBridge } from "../widget/mount-arrow-sandbox"
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
  TDraftPreviewResult,
  TDraftPreviewRuntime,
  TDraftPreviewSummary,
} from "./typed"
import type { TWidgetWorldBounds } from "@vibecanvas/canvas/services"

type TDraftPreviewFrameServiceArgs = {
  api: TAiChatApiPort
  application: TAiChatApplicationPort
  browser: TWidgetBrowserPort
  crdt: CrdtService
  element: ElementService
  history?: HistoryService
  renderOrder: RenderOrderService
  scene: SceneService
  selection: SelectionService
  tool: ToolService
}

type TNodeOnRemove = (args: { node: unknown }) => void

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
  const pinnedRevision = payload?.pinnedRevision
  const originChatElementId = payload?.originChatElementId
  if (typeof draftId !== "string" || !draftId.trim()) return undefined
  if (typeof pinnedRevision !== "string" || !pinnedRevision.trim()) return undefined
  if (originChatElementId !== undefined && (typeof originChatElementId !== "string" || !originChatElementId.trim())) return undefined
  return { draftId, pinnedRevision, ...(originChatElementId ? { originChatElementId } : {}) }
}

export class DraftPreviewFrameService implements IService, IStoppableService {
  readonly name = "draft-preview-frame"
  readonly #args: TDraftPreviewFrameServiceArgs
  readonly #initialResults = new Map<string, {
    previewId: string
    result?: TDraftPreviewResult
    ownedRevision?: { draftId: string; revision: string }
  }>()
  readonly #runtimes = new Map<string, { payload: TDraftPreviewPayload; runtime: TDraftPreviewRuntime }>()
  readonly #pendingReleases = new Map<string, { timer: unknown; draftId: string; revision: string }>()
  readonly #frameQueues = new Map<string, Promise<unknown>>()
  readonly #framePromises = new Set<Promise<unknown>>()
  readonly #cleanupPromises = new Set<Promise<unknown>>()
  #stopping = false

  constructor(args: TDraftPreviewFrameServiceArgs) {
    this.#args = args
  }

  async stop() {
    this.#stopping = true

    this.#initialResults.forEach(({ previewId, result, ownedRevision }) => {
      const owned = result?.ready
        ? { draftId: result.draftId, revision: result.revision }
        : ownedRevision
      if (owned) this.#trackCleanup(this.#closePreview(previewId, owned.draftId, owned.revision))
    })
    this.#initialResults.clear()

    this.#pendingReleases.forEach((release, previewId) => {
      this.#args.browser.clearTimeout(release.timer)
      this.#trackCleanup(this.#closePreview(previewId, release.draftId, release.revision))
    })
    this.#pendingReleases.clear()

    const runtimeDisposals = [...this.#runtimes.values()].map(({ runtime }) => runtime.dispose())
    this.#runtimes.clear()

    await Promise.allSettled([...this.#framePromises, ...runtimeDisposals])
    while (this.#cleanupPromises.size > 0) {
      await Promise.allSettled([...this.#cleanupPromises])
    }
  }

  getTitle(element: TElement) {
    const payload = getDraftPreviewPayload(element)
    return payload ? `${payload.draftId} Preview` : "Draft Preview"
  }

  mount(args: { root: HTMLDivElement; element: TElement; titleBar?: TWidgetTitleBarPortal }) {
    if (this.#stopping) {
      this.#initialResults.delete(args.element.id)
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

    const previousRuntime = this.#runtimes.get(args.element.id)?.runtime
    if (previousRuntime) {
      this.#runtimes.delete(args.element.id)
      this.#trackCleanup(previousRuntime.dispose())
    }
    const prepared = this.#initialResults.get(args.element.id)
    this.#initialResults.delete(args.element.id)
    const previewId = prepared?.previewId ?? this.#args.browser.createId()
    let runtime!: TDraftPreviewRuntime
    runtime = mountDraftPreview({
      root: args.root,
      api: this.#args.api,
      previewId,
      payload,
      initialResult: prepared?.result,
      mountSandbox: mountArrowSandboxBridge,
      onPersistRevision: (revision) => this.#persistRevision(args.element.id, revision),
      onReleaseRevision: (revision) => this.#scheduleRelease(previewId, payload.draftId, revision),
      onLogError: this.#args.application.logError,
    })
    this.#runtimes.set(args.element.id, { payload, runtime })
    const publicationApi = this.#args.api.api.agent as unknown as Partial<TWidgetPublicationApi>
    const disposePublication = args.titleBar
      && publicationApi.widgets?.detail
      && publicationApi.widgetPublish?.publish
      ? mountWidgetPublicationDialog({
        document: args.root.ownerDocument,
        api: publicationApi as TWidgetPublicationApi,
        draftId: payload.draftId,
        getPinnedRevision: () => runtime.getOwnedRevision(),
        titleBar: args.titleBar,
        onRequestPreviewRefresh: () => runtime.refresh(),
        onPublished: async () => {
          this.#args.application.invalidateWidgetCatalog?.()
          await runtime.refresh()
        },
      })
      : () => undefined

    return () => {
      disposePublication()
      if (this.#runtimes.get(args.element.id)?.runtime === runtime) {
        this.#runtimes.delete(args.element.id)
      }
      this.#trackCleanup(runtime.dispose())
      args.root.replaceChildren()
    }
  }

  open(args: { draftName: string; originChatElementId: string }) {
    if (this.#stopping) {
      return Promise.reject(new Error("Draft Preview opening was cancelled because the canvas is stopping."))
    }
    return this.#queueFrame(args.draftName, () => this.#open(args))
  }

  place(args: {
    draftName: string
    expectedRevision: string
    previewId: string
    bounds: TWidgetWorldBounds
  }) {
    if (this.#stopping) {
      return Promise.reject(new Error("Draft Preview placement was cancelled because the canvas is stopping."))
    }
    return this.#queueFrame(args.draftName, () => this.#place(args))
  }

  async #place(args: {
    draftName: string
    expectedRevision: string
    previewId: string
    bounds: TWidgetWorldBounds
  }) {
    this.#throwIfStopping()
    const timestamp = this.#args.browser.now()
    const element: TElement = {
      id: fnDraftPreviewElementId(args.draftName, args.previewId),
      x: args.bounds.x,
      y: args.bounds.y,
      rotation: 0,
      zIndex: "",
      parentGroupId: null,
      bindings: [],
      locked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      data: {
        type: "ui-widget",
        kind: DRAFT_PREVIEW_WIDGET_KIND,
        w: args.bounds.width,
        h: args.bounds.height,
        expanded: true,
        window: "contained",
        payload: {
          draftId: args.draftName,
          pinnedRevision: args.expectedRevision,
        } satisfies TDraftPreviewPayload,
      },
      style: {},
    }
    this.#initialResults.set(element.id, {
      previewId: args.previewId,
      ownedRevision: { draftId: args.draftName, revision: args.expectedRevision },
    })
    let node: Konva.Group | undefined
    try {
      const createdNode = this.#args.element.createNodeFromElement(element)
      if (!isKonvaGroup(createdNode)) throw new Error("The draft Preview frame could not be created.")
      node = createdNode
      this.#args.scene.staticForegroundLayer.add(node)
      this.#args.renderOrder.assignOrderOnInsert({
        parent: this.#args.scene.staticForegroundLayer,
        nodes: [node],
        position: "front",
      })
      const persisted = this.#args.element.toElement(node)
      if (!persisted) throw new Error("The draft Preview frame could not be persisted.")
      const commitResult = this.#args.crdt.build().patchElement(persisted.id, persisted).commit()
      this.#focusNode(node)
      this.#args.scene.staticForegroundLayer.batchDraw()
      this.#recordCreateHistory(persisted, node, commitResult)
      return persisted
    } catch (error) {
      node?.destroy()
      this.#initialResults.delete(element.id)
      this.#scheduleRelease(args.previewId, args.draftName, args.expectedRevision)
      throw error
    }
  }

  #queueFrame<TResult>(draftName: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = this.#frameQueues.get(draftName) ?? Promise.resolve()
    let queued!: Promise<TResult>
    queued = previous
      .catch(() => undefined)
      .then(() => {
        this.#throwIfStopping()
        return operation()
      })
      .finally(() => {
        this.#framePromises.delete(queued)
        if (this.#frameQueues.get(draftName) === queued) this.#frameQueues.delete(draftName)
      })
    this.#frameQueues.set(draftName, queued)
    this.#framePromises.add(queued)
    return queued
  }

  async #open(args: { draftName: string; originChatElementId: string }) {
    const summary = await this.#getDraft(args.draftName)
    this.#throwIfStopping()
    const existing = this.#findFrame(summary.draftId)
    if (existing) {
      const node = this.#ensureNode(existing)
      this.#throwIfStopping()
      this.#focusNode(node)
      const runtime = this.#runtimes.get(existing.id)?.runtime
      if (!runtime) throw new Error(`Draft Preview frame '${existing.id}' could not be mounted.`)
      await runtime.refresh(summary)
      this.#throwIfStopping()
      return
    }

    const origin = this.#args.crdt.doc().elements[args.originChatElementId]
    if (!origin || origin.data.type !== "ui-widget") {
      throw new Error("The originating AI Chat frame is no longer available.")
    }

    const elementId = fnDraftPreviewElementId(summary.draftId)
    const previewId = this.#args.browser.createId()
    const result = await this.#preparePreview(summary, previewId)
    let element!: TElement
    let node: Konva.Group | undefined
    let persisted!: TElement
    let commitResult!: ReturnType<ReturnType<CrdtService["build"]>["commit"]>
    try {
      this.#throwIfStopping()
      const concurrentFrame = this.#findFrame(summary.draftId)
      if (concurrentFrame) {
        if (result.ready) await this.#closePreview(previewId, result.draftId, result.revision)
        const concurrentNode = this.#ensureNode(concurrentFrame)
        this.#focusNode(concurrentNode)
        const concurrentRuntime = this.#runtimes.get(concurrentFrame.id)?.runtime
        if (!concurrentRuntime) throw new Error(`Draft Preview frame '${concurrentFrame.id}' could not be mounted.`)
        await concurrentRuntime.refresh(summary)
        this.#throwIfStopping()
        return
      }
      const originBounds = this.#getOriginWorldBounds(origin)
      const timestamp = this.#args.browser.now()
      element = {
        id: elementId,
        x: originBounds.x + originBounds.width + DRAFT_PREVIEW_FRAME_GAP,
        y: originBounds.y,
        rotation: 0,
        zIndex: "",
        parentGroupId: null,
        bindings: [],
        locked: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        data: {
          type: "ui-widget",
          kind: DRAFT_PREVIEW_WIDGET_KIND,
          w: Math.max(DRAFT_PREVIEW_MIN_WIDTH, originBounds.width),
          h: Math.max(DRAFT_PREVIEW_MIN_HEIGHT, originBounds.height),
          expanded: true,
          window: "contained",
          payload: {
            draftId: summary.draftId,
            pinnedRevision: summary.revision,
            originChatElementId: args.originChatElementId,
          } satisfies TDraftPreviewPayload,
        },
        style: {},
      }

      this.#initialResults.set(element.id, { previewId, result })
      const createdNode = this.#args.element.createNodeFromElement(element)
      if (!isKonvaGroup(createdNode)) throw new Error("The draft Preview frame could not be created.")
      node = createdNode
      this.#args.scene.staticForegroundLayer.add(node)
      this.#args.renderOrder.assignOrderOnInsert({
        parent: this.#args.scene.staticForegroundLayer,
        nodes: [node],
        position: "front",
      })
      const nextPersisted = this.#args.element.toElement(node)
      if (!nextPersisted) throw new Error("The draft Preview frame could not be persisted.")
      persisted = nextPersisted
      commitResult = this.#args.crdt.build().patchElement(persisted.id, persisted).commit()
    } catch (error) {
      node?.destroy()
      this.#initialResults.delete(elementId)
      if (result.ready) this.#scheduleRelease(previewId, result.draftId, result.revision)
      throw error
    }
    this.#focusNode(node)
    this.#args.scene.staticForegroundLayer.batchDraw()
    this.#recordCreateHistory(persisted, node, commitResult)
  }

  async #getDraft(draftName: string): Promise<TDraftPreviewSummary> {
    const [error, summary] = await this.#args.api.api.agent.widgetDraft.get({ draftId: draftName })
    if (error) throw new Error(getErrorMessage(error, "Could not read the widget draft."))
    if (!summary) throw new Error(`Widget draft '${draftName}' was not found.`)
    return summary
  }

  async #preparePreview(summary: TDraftPreviewSummary, previewId: string): Promise<TDraftPreviewResult> {
    const [getError, existing] = await this.#args.api.api.agent.widgetPreview.get({
      draftId: summary.draftId,
      previewId,
    })
    if (getError) throw new Error(getErrorMessage(getError, "Could not read Preview state."))
    if (!existing) throw new Error("Preview state was unavailable.")
    const current: TDraftPreviewResult = existing
    this.#throwIfPreviewMissing(current, summary.draftId)
    if (current.ready && current.draftId === summary.draftId && current.revision === summary.revision) return current
    this.#throwIfStopping()

    const [buildError, built] = await this.#args.api.api.agent.widgetPreview.build({
        draftId: summary.draftId,
        previewId,
        expectedRevision: summary.revision,
      })
      .catch(async (error) => {
        await this.#closePreview(previewId, summary.draftId, summary.revision)
        throw error
      })
    if (buildError) {
      await this.#closePreview(previewId, summary.draftId, summary.revision)
      throw new Error(getErrorMessage(buildError, "Could not build Preview."))
    }
    if (!built) {
      await this.#closePreview(previewId, summary.draftId, summary.revision)
      throw new Error("Preview build returned no result.")
    }
    const result: TDraftPreviewResult = built
    this.#throwIfPreviewMissing(result, summary.draftId)
    return result
  }

  #findFrame(draftId: string) {
    return Object.values(this.#args.crdt.doc().elements).find((element) => {
      return getDraftPreviewPayload(element)?.draftId === draftId
    })
  }

  #findNode(elementId: string) {
    const node = this.#args.scene.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return isKonvaGroup(candidate) && candidate.id() === elementId
    })
    return isKonvaGroup(node) ? node : undefined
  }

  #getOriginWorldBounds(origin: TElement) {
    const node = this.#findNode(origin.id)
    if (!node) throw new Error("The originating AI Chat frame could not be located on the canvas.")
    const bounds = node.getClientRect({
      relativeTo: this.#args.scene.staticForegroundLayer,
      skipShadow: true,
      skipStroke: true,
    })
    if (
      !Number.isFinite(bounds.x)
      || !Number.isFinite(bounds.y)
      || !Number.isFinite(bounds.width)
      || !Number.isFinite(bounds.height)
      || bounds.width <= 0
      || bounds.height <= 0
    ) {
      throw new Error("The originating AI Chat frame does not have usable canvas bounds.")
    }
    return bounds
  }

  #throwIfPreviewMissing(result: TDraftPreviewResult, draftId: string) {
    if (!result.ready && result.reason === "not-found") {
      throw new Error(result.message || `Widget draft '${draftId}' was not found.`)
    }
  }

  #throwIfStopping() {
    if (this.#stopping) throw new Error("Draft Preview opening was cancelled because the canvas is stopping.")
  }

  #ensureNode(element: TElement) {
    const existing = this.#findNode(element.id)
    if (existing) return existing
    const node = this.#args.element.createNodeFromElement(element)
    if (!isKonvaGroup(node)) throw new Error("The persisted draft Preview frame could not be restored.")
    this.#args.scene.staticForegroundLayer.add(node)
    this.#args.element.updateElement(element)
    this.#args.renderOrder.sortChildren(this.#args.scene.staticForegroundLayer)
    this.#args.scene.staticForegroundLayer.batchDraw()
    return node
  }

  #focusNode(node: Konva.Group) {
    this.#args.tool.setActiveTool("select")
    this.#args.selection.setSelection([node])
    this.#args.selection.setFocusedNode(node)
    this.#args.scene.staticForegroundLayer.batchDraw()
  }

  #persistRevision(elementId: string, revision: string) {
    const current = this.#args.crdt.doc().elements[elementId]
    if (!current || current.data.type !== "ui-widget" || current.data.kind !== DRAFT_PREVIEW_WIDGET_KIND) return
    const payload = getDraftPreviewPayload(current)
    if (!payload || payload.pinnedRevision === revision) return
    const nextData: TUiWidgetData = {
      ...current.data,
      payload: { ...payload, pinnedRevision: revision },
    }
    const node = this.#findNode(elementId)
    node?.setAttr(ELEMENT_DATA_ATTR, nextData)
    this.#args.crdt.build().patchElement(elementId, "data", nextData).commit()
    const runtimeEntry = this.#runtimes.get(elementId)
    if (runtimeEntry) runtimeEntry.payload = { ...runtimeEntry.payload, pinnedRevision: revision }
  }

  #recordCreateHistory(
    element: TElement,
    initialNode: Konva.Group,
    commitResult: ReturnType<ReturnType<CrdtService["build"]>["commit"]>,
  ) {
    if (!this.#args.history) return
    let currentNode: Konva.Group | undefined = initialNode
    this.#args.history.record({
      label: "create-draft-preview",
      undo: () => {
        const node = currentNode ?? this.#findNode(element.id)
        if (node) {
          const onRemove = node.getAttr(VC_ON_REMOVE_ATTR) as TNodeOnRemove | undefined
          onRemove?.({ node })
          node.destroy()
          currentNode = undefined
        }
        commitResult.rollback()
        this.#args.selection.clear()
        this.#args.scene.staticForegroundLayer.batchDraw()
      },
      redo: () => {
        const node = this.#args.element.createNodeFromElement(element)
        if (!isKonvaGroup(node)) return
        this.#args.scene.staticForegroundLayer.add(node)
        this.#args.element.updateElement(element)
        this.#args.renderOrder.sortChildren(this.#args.scene.staticForegroundLayer)
        this.#args.crdt.applyOps({ ops: commitResult.redoOps })
        this.#focusNode(node)
        currentNode = node
      },
    })
  }

  #scheduleRelease(previewId: string, draftId: string, revision: string) {
    this.#cancelPendingRelease(previewId)
    if (this.#stopping) {
      this.#trackCleanup(this.#closePreview(previewId, draftId, revision))
      return
    }
    const timer = this.#args.browser.setTimeout(() => {
      const pending = this.#pendingReleases.get(previewId)
      if (!pending || pending.timer !== timer) return
      this.#pendingReleases.delete(previewId)
      this.#trackCleanup(this.#closePreview(previewId, draftId, revision))
    }, 0)
    this.#pendingReleases.set(previewId, { timer, draftId, revision })
  }

  #cancelPendingRelease(previewId: string) {
    const pending = this.#pendingReleases.get(previewId)
    if (!pending) return
    this.#args.browser.clearTimeout(pending.timer)
    this.#pendingReleases.delete(previewId)
  }

  async #closePreview(previewId: string, draftId: string, revision: string) {
    try {
      const [error] = await this.#args.api.api.agent.widgetPreview.close({
        draftId,
        previewId,
        expectedRevision: revision,
      })
      if (error) this.#args.application.logError(error)
    } catch (error) {
      this.#args.application.logError(error)
    }
  }

  #trackCleanup(promise: Promise<unknown>) {
    this.#cleanupPromises.add(promise)
    void promise.finally(() => this.#cleanupPromises.delete(promise))
  }
}
