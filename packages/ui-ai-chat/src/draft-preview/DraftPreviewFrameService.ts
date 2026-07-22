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
  TDraftPreviewOwnership,
  TDraftPreviewReady,
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

type TDraftPreviewOpenArgs = {
  draftId?: string
  draftName: string
  originChatElementId: string
}

const LOWERCASE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

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
  const draftRevision = payload?.draftRevision
  const previewId = payload?.previewId
  const previewRevisionId = payload?.previewRevisionId
  const originChatElementId = payload?.originChatElementId
  if (typeof draftId !== "string" || !draftId.trim()) return undefined
  if (typeof draftName !== "string" || !draftName.trim()) return undefined
  if (typeof draftRevision !== "string" || !draftRevision.trim()) return undefined
  if (typeof previewId !== "string" || !LOWERCASE_UUID_PATTERN.test(previewId)) return undefined
  if (typeof previewRevisionId !== "string" || !previewRevisionId.trim()) return undefined
  if (originChatElementId !== undefined && (typeof originChatElementId !== "string" || !originChatElementId.trim())) return undefined
  return { draftId, draftName, draftRevision, previewId, previewRevisionId, ...(originChatElementId ? { originChatElementId } : {}) }
}

export class DraftPreviewFrameService implements IService, IStoppableService {
  readonly name = "draft-preview-frame"
  readonly #args: TDraftPreviewFrameServiceArgs
  readonly #initialResults = new Map<string, TDraftPreviewReady>()
  readonly #runtimes = new Map<string, { payload: TDraftPreviewPayload; runtime: TDraftPreviewRuntime }>()
  readonly #pendingReleases = new Map<string, {
    timer: unknown
    previewId: string
    draftId: string
    previewRevisionId: string
  }>()
  readonly #frameQueues = new Map<string, Promise<unknown>>()
  readonly #framePromises = new Set<Promise<unknown>>()
  readonly #cleanupPromises = new Set<Promise<unknown>>()
  #stopping = false

  constructor(args: TDraftPreviewFrameServiceArgs) {
    this.#args = args
  }

  async stop() {
    this.#stopping = true

    this.#initialResults.forEach((result) => {
      this.#trackCleanup(this.#closePreview(
        result.previewId,
        result.draftId,
        result.previewRevisionId,
      ))
    })
    this.#initialResults.clear()

    this.#pendingReleases.forEach((release) => {
      this.#args.browser.clearTimeout(release.timer)
      this.#trackCleanup(this.#closePreview(
        release.previewId,
        release.draftId,
        release.previewRevisionId,
      ))
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
    return payload ? `${payload.draftName} Preview` : "Draft Preview"
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
    const previewId = payload.previewId
    this.#cancelPendingRelease(previewId, payload.previewRevisionId)
    let runtime!: TDraftPreviewRuntime
    runtime = mountDraftPreview({
      root: args.root,
      api: this.#args.api,
      browser: this.#args.browser,
      payload,
      initialResult: prepared,
      mountArtifact: widgetUiArtifactMount,
      onPersistOwnership: (ownership) => this.#persistOwnership(args.element.id, ownership),
      onReleaseOwnership: (ownership) => {
        const replacement = this.#runtimes.get(args.element.id)?.runtime
        if (
          replacement
          && replacement !== runtime
          && replacement.getOwnedPreviewRevisionId() === ownership.previewRevisionId
        ) return
        this.#scheduleRelease(previewId, payload.draftId, ownership.previewRevisionId)
      },
      onResetStateChange: (state) => args.titleBar?.setActionState("reset", state),
      onLogError: this.#args.application.logError,
    })
    this.#runtimes.set(args.element.id, { payload, runtime })
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
      disposeReset()
      disposePublication()
      if (this.#runtimes.get(args.element.id)?.runtime === runtime) {
        this.#runtimes.delete(args.element.id)
      }
      this.#trackCleanup(runtime.dispose())
      args.root.replaceChildren()
    }
  }

  open(args: TDraftPreviewOpenArgs) {
    if (this.#stopping) {
      return Promise.reject(new Error("Draft Preview opening was cancelled because the canvas is stopping."))
    }
    return this.#queueFrame(args.draftId ?? `name:${args.draftName}`, () => this.#open(args))
  }

  place(args: {
    draftId: string
    expectedRevision: string
    previewId: string
    bounds: TWidgetWorldBounds
  }) {
    if (this.#stopping) {
      return Promise.reject(new Error("Draft Preview placement was cancelled because the canvas is stopping."))
    }
    return this.#queueFrame(args.draftId, () => this.#place(args))
  }

  async #place(args: {
    draftId: string
    expectedRevision: string
    previewId: string
    bounds: TWidgetWorldBounds
  }) {
    this.#throwIfStopping()
    this.#assertPreviewId(args.previewId)
    const result = await this.#preparePreview({
      draftId: args.draftId,
      revision: args.expectedRevision,
    }, args.previewId)
    if (this.#stopping) {
      await this.#closePreview(result.previewId, result.draftId, result.previewRevisionId)
      this.#throwIfStopping()
    }
    const timestamp = this.#args.browser.now()
    const elementId = fnDraftPreviewElementId(result.draftId, args.previewId)
    const element: TElement = {
      id: elementId,
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
          draftId: result.draftId,
          draftName: result.name,
          draftRevision: result.revision,
          previewId: result.previewId,
          previewRevisionId: result.previewRevisionId,
        } satisfies TDraftPreviewPayload,
      },
      style: {},
    }
    this.#initialResults.set(element.id, result)
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
      this.#scheduleRelease(args.previewId, result.draftId, result.previewRevisionId)
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

  async #open(args: TDraftPreviewOpenArgs) {
    const summary = await this.#resolveDraft(args)
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
    this.#assertPreviewId(previewId)
    const result = await this.#preparePreview(summary, previewId)
    let element!: TElement
    let node: Konva.Group | undefined
    let persisted!: TElement
    let commitResult!: ReturnType<ReturnType<CrdtService["build"]>["commit"]>
    try {
      this.#throwIfStopping()
      const concurrentFrame = this.#findFrame(summary.draftId)
      if (concurrentFrame) {
        await this.#closePreview(previewId, result.draftId, result.previewRevisionId)
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
            draftName: result.name,
            draftRevision: result.revision,
            previewId,
            previewRevisionId: result.previewRevisionId,
            originChatElementId: args.originChatElementId,
          } satisfies TDraftPreviewPayload,
        },
        style: {},
      }

      this.#initialResults.set(element.id, result)
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
      this.#scheduleRelease(previewId, result.draftId, result.previewRevisionId)
      throw error
    }
    this.#focusNode(node)
    this.#args.scene.staticForegroundLayer.batchDraw()
    this.#recordCreateHistory(persisted, node, commitResult)
  }

  async #resolveDraft(args: Pick<TDraftPreviewOpenArgs, "draftId" | "draftName">): Promise<TDraftPreviewSummary> {
    if (args.draftId) return this.#getDraft(args.draftId)

    const [listError, summaries] = await this.#args.api.api.agent.widgetDraft.list({})
    if (listError) throw new Error(getErrorMessage(listError, "Could not list widget drafts."))
    const matches = summaries.filter((summary) => summary.name === args.draftName)
    if (matches.length !== 1) {
      throw new Error(matches.length === 0
        ? `Widget draft '${args.draftName}' was not found.`
        : `Widget draft name '${args.draftName}' is ambiguous.`)
    }
    const summary = await this.#getDraft(matches[0]!.draftId)
    if (summary.name !== args.draftName) {
      throw new Error(`Widget draft '${args.draftName}' changed before Preview could open.`)
    }
    return summary
  }

  async #getDraft(draftId: string): Promise<TDraftPreviewSummary> {
    const [error, summary] = await this.#args.api.api.agent.widgetDraft.get({ draftId })
    if (error) throw new Error(getErrorMessage(error, "Could not read the widget draft."))
    if (!summary) throw new Error(`Widget draft '${draftId}' was not found.`)
    return summary
  }

  async #preparePreview(
    summary: Pick<TDraftPreviewSummary, "draftId" | "revision">,
    previewId: string,
  ): Promise<TDraftPreviewReady> {
    const [getError, existing] = await this.#args.api.api.agent.widgetPreview.get({
      draftId: summary.draftId,
      previewId,
    })
    if (getError) throw new Error(getErrorMessage(getError, "Could not read Preview state."))
    if (!existing) throw new Error("Preview state was unavailable.")
    const current: TDraftPreviewResult = existing
    this.#throwIfPreviewMissing(current, summary.draftId)
    if (
      current.ready
      && current.draftId === summary.draftId
      && current.previewId === previewId
      && current.revision === summary.revision
    ) return current
    this.#throwIfStopping()

    let buildResponse: Awaited<ReturnType<
      TAiChatApiPort["api"]["agent"]["widgetPreview"]["build"]
    >>
    try {
      buildResponse = await this.#args.api.api.agent.widgetPreview.build({
        draftId: summary.draftId,
        previewId,
        expectedDraftRevision: summary.revision,
        expectedActivePreviewRevisionId: current.ready
          ? current.previewRevisionId
          : current.previewRevisionId ?? null,
      })
    } catch (error) {
      return this.#reconcileAmbiguousPreviewBuild(summary, previewId, error)
    }
    const [buildError, built] = buildResponse
    if (buildError || !built) {
      return this.#reconcileAmbiguousPreviewBuild(
        summary,
        previewId,
        buildError ?? new Error("Preview build returned no result."),
      )
    }
    const result: TDraftPreviewResult = built
    this.#throwIfPreviewMissing(result, summary.draftId)
    if (!result.ready) throw new Error(result.message || "Preview build failed.")
    if (
      result.draftId !== summary.draftId
      || result.previewId !== previewId
      || result.revision !== summary.revision
    ) {
      this.#scheduleRelease(result.previewId, result.draftId, result.previewRevisionId)
      throw new Error("Preview build returned a different owner or draft revision.")
    }
    return result
  }

  async #reconcileAmbiguousPreviewBuild(
    summary: Pick<TDraftPreviewSummary, "draftId" | "revision">,
    previewId: string,
    buildError: unknown,
  ): Promise<TDraftPreviewReady> {
    const failure = new Error(getErrorMessage(buildError, "Could not build Preview."))
    let response: Awaited<ReturnType<
      TAiChatApiPort["api"]["agent"]["widgetPreview"]["get"]
    >>
    try {
      response = await this.#args.api.api.agent.widgetPreview.get({
        draftId: summary.draftId,
        previewId,
      })
    } catch (error) {
      this.#args.application.logError(error)
      throw failure
    }
    const [getError, recovered] = response
    if (getError || !recovered) {
      if (getError) this.#args.application.logError(getError)
      throw failure
    }
    const result: TDraftPreviewResult = recovered
    if (
      result.ready
      && result.draftId === summary.draftId
      && result.previewId === previewId
      && result.revision === summary.revision
    ) return result

    if (
      result.draftId === summary.draftId
      && result.previewId === previewId
      && result.previewRevisionId
    ) {
      await this.#closePreview(previewId, summary.draftId, result.previewRevisionId)
    }
    throw failure
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

  #assertPreviewId(previewId: string) {
    if (!LOWERCASE_UUID_PATTERN.test(previewId)) {
      throw new Error("Draft Preview owner identity must be a lowercase UUID.")
    }
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

  #persistOwnership(elementId: string, ownership: TDraftPreviewOwnership) {
    const current = this.#args.crdt.doc().elements[elementId]
    if (!current || current.data.type !== "ui-widget" || current.data.kind !== DRAFT_PREVIEW_WIDGET_KIND) return
    const payload = getDraftPreviewPayload(current)
    if (
      !payload
      || (
        payload.draftRevision === ownership.draftRevision
        && payload.previewRevisionId === ownership.previewRevisionId
      )
    ) return
    const nextPayload: TDraftPreviewPayload = {
      ...payload,
      draftRevision: ownership.draftRevision,
      previewRevisionId: ownership.previewRevisionId,
    }
    const nextData: TUiWidgetData = {
      ...current.data,
      payload: nextPayload,
    }
    const node = this.#findNode(elementId)
    node?.setAttr(ELEMENT_DATA_ATTR, nextData)
    this.#args.crdt.build().patchElement(elementId, "data", nextData).commit()
    const runtimeEntry = this.#runtimes.get(elementId)
    if (runtimeEntry) runtimeEntry.payload = nextPayload
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

  #releaseKey(previewId: string, previewRevisionId: string) {
    return `${previewId}\u0000${previewRevisionId}`
  }

  #scheduleRelease(previewId: string, draftId: string, previewRevisionId: string) {
    const key = this.#releaseKey(previewId, previewRevisionId)
    this.#cancelPendingRelease(previewId, previewRevisionId)
    if (this.#stopping) {
      this.#trackCleanup(this.#closePreview(previewId, draftId, previewRevisionId))
      return
    }
    const timer = this.#args.browser.setTimeout(() => {
      const pending = this.#pendingReleases.get(key)
      if (!pending || pending.timer !== timer) return
      this.#pendingReleases.delete(key)
      this.#trackCleanup(this.#closePreview(previewId, draftId, previewRevisionId))
    }, 0)
    this.#pendingReleases.set(key, { timer, previewId, draftId, previewRevisionId })
  }

  #cancelPendingRelease(previewId: string, previewRevisionId: string) {
    const key = this.#releaseKey(previewId, previewRevisionId)
    const pending = this.#pendingReleases.get(key)
    if (!pending) return
    this.#args.browser.clearTimeout(pending.timer)
    this.#pendingReleases.delete(key)
  }

  async #closePreview(previewId: string, draftId: string, previewRevisionId: string) {
    try {
      const [error] = await this.#args.api.api.agent.widgetPreview.close({
        draftId,
        previewId,
        expectedPreviewRevisionId: previewRevisionId,
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
