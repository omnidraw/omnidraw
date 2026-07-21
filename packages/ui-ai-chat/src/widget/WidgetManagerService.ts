import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext, IStoppableService } from "@vibecanvas/runtime/interface.js";
import type { TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { CameraService, ConfirmDialogService, ContextMenuService, CrdtService, ElementService, HistoryService, LoggingService, RenderOrderService, SceneService, SelectionService, ToolService } from "@vibecanvas/canvas/services";
import { ELEMENT_DATA_ATTR, VC_ON_REMOVE_ATTR } from "@vibecanvas/canvas/core/CONSTANTS";
import type { IRuntimeConfig, IRuntimeHooks } from "@vibecanvas/canvas";
import {
    WIDGET_DOM_PORTAL_SYNC_ATTR,
    WIDGET_HOST_BODY_ID,
    WIDGET_HOST_BORDER_ID,
    WIDGET_HOST_DIVIDER_ID,
    WIDGET_HOST_HEADER_HEIGHT,
    WIDGET_HOST_HEADER_ID,
    WIDGET_HOST_MIN_HEIGHT,
    WIDGET_HOST_MIN_WIDTH,
    WIDGET_HOST_WINDOW_CORNER_RADIUS,
    WIDGET_WINDOW_CONTAINED,
    WIDGET_WINDOW_FULLSCREEN,
} from "./CONSTANTS";
import { fnCreateWidgetNode } from "./fn.create-widget-node";
import { fnGetHostThemeColors } from "./fn.get-host-theme-colors";
import { fnToWidgetElement } from "./fn.to-widget-element";
import { fxAttachWidgetListener } from "./fx.attach-widget-listener";
import { fxRegisterWidgetTool } from "./fx.register-tool";
import type {
  IWidgetConfig,
  IWidgetManagerServiceHooks,
  IWidgetManagerServiceProps,
  TWidgetFullscreenHostActions,
} from "./interface";
import { txAttachDomPortal } from "./attach-dom-portal";
import { txCreateWidgetCloneDrag } from "./tx.create-widget-clone-drag";
import { txResizeWidgetHost } from "./tx.resize-widget-host";
import { txUpdateWidgetNodeFromElement } from "./tx.update-widget-node-from-element";
import type { TActorEvent } from "@vibecanvas/api/actor/contract";
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { TWidgetError } from '@vibecanvas/service-db/model';
import type { TWidgetBrowserPort, TWidgetTransportPort } from "../ports";
import type { TWidgetDropRequest, TWidgetWorldBounds } from "@vibecanvas/canvas/services";
import { fnCreateWidgetElement } from "./fn.create-widget-element";
import { fnWidgetErrorsEqual } from "./fn.widget-errors-equal";

type TWidgetDomPortalSync = () => void;
type TNodeOnRemove = (args: { node: unknown }) => void;

export type TWidgetActorEvent = TActorEvent;

type TWidgetActorEventHandler = (event: TWidgetActorEvent) => void;

export class WidgetManagerService implements IService<IWidgetManagerServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = "widget-manager";
  #crdtService: CrdtService;
  #historyService?: HistoryService;
  #loggingService: LoggingService;
  #themeService: ThemeService;
  #selectionService: SelectionService;
  #contextMenuService: ContextMenuService;
  #elementService: ElementService;
  #toolService: ToolService;
  #sceneService: SceneService;
  #renderOrderService: RenderOrderService;
  #cameraService: CameraService;
  #confirmDialogService: ConfirmDialogService;
  #widgetPortal!: HTMLDivElement;
  #removeSelectionChangeListener?: () => boolean;
  #browser: TWidgetBrowserPort;
  #transport: TWidgetTransportPort;
  #actorEventSubscribers = new Map<string, Set<TWidgetActorEventHandler>>();
  #isActorEventListenerRunning = false;
  #registeredWidgetKinds = new Set<string>();
  #registeredWidgetConfigs = new Map<string, IWidgetConfig>();
  #registeredToolIdsByKind = new Map<string, string>();
  #definitionErrors = new Map<string, TWidgetError>();
  #elementErrors = new Map<string, TWidgetError>();
  #globalDefinitionError: TWidgetError | null = null;
  #definitionDiscoveryComplete = false;
  #activeActorEventIterator: AsyncIterator<unknown> | null = null;
  #reconnectTimer: unknown | null = null;
  #resolveReconnectWait: (() => void) | null = null;

  private readonly runtimeHooks!: IRuntimeHooks;


  constructor(props: IWidgetManagerServiceProps) {
    this.#crdtService = props.crdtService;
    this.#historyService = props.historyService;
    this.#loggingService = props.loggingService;
    this.#themeService = props.themeService;
    this.#selectionService = props.selectionService;
    this.#contextMenuService = props.contextMenuService;
    this.#elementService = props.elementService;
    this.#toolService = props.toolService;
    this.#sceneService = props.sceneService;
    this.#renderOrderService = props.renderOrderService;
    this.#cameraService = props.cameraService;
    this.#confirmDialogService = props.confirmDialogService;
    this.#browser = props.browser;
    this.#transport = props.transport;
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void | Promise<void> {
    // @ts-expect-error this is safe, start runs before any other method
    this.runtimeHooks = ctx.hooks;
    this.#widgetPortal = this.#browser.document.createElement("div");
    this.#widgetPortal.style = "position: absolute; inset: 0; pointer-events: none;";
    this.#sceneService.stage.container().appendChild(this.#widgetPortal);
    // this.#domPortal.style =
    this.#widgetPortal.id = "widget-portal";

    this.#registerFallbackWidgetDefinition();

    this.#isActorEventListenerRunning = true;
    void this.#listenToActorEvents();
  }

  stop(): void | Promise<void> {
    this.#isActorEventListenerRunning = false;
    if (this.#reconnectTimer !== null) this.#browser.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#resolveReconnectWait?.();
    this.#resolveReconnectWait = null;
    this.#closeActorEventIterator(this.#activeActorEventIterator);
    this.#activeActorEventIterator = null;
    this.#actorEventSubscribers.clear();
    this.#removeSelectionChangeListener?.();
    this.#removeSelectionChangeListener = undefined;
    this.#contextMenuService.close();
    this.#widgetPortal.remove()
  }


  async #listenToActorEvents() {
    let delay = 250;
    while (this.#isActorEventListenerRunning) {
      try {
        const [err, it] = await this.#transport.api.actors.events({});
        if (err) throw err;
        delay = 250;
        const iterator = it[Symbol.asyncIterator]();
        if (!this.#isActorEventListenerRunning) {
          this.#closeActorEventIterator(iterator);
          return;
        }
        this.#activeActorEventIterator = iterator;
        try {
          while (this.#isActorEventListenerRunning) {
            const next = await iterator.next();
            if (next.done) break;
            this.#routeActorEvent(next.value as TWidgetActorEvent);
          }
        } finally {
          if (this.#activeActorEventIterator === iterator) {
            this.#activeActorEventIterator = null;
            this.#closeActorEventIterator(iterator);
          }
        }
      } catch (error) {
        this.#activeActorEventIterator = null;
        this.#loggingService.warn({ kind: 'service', name: this.name, level: 1, event: 'actor-event-stream-disconnected', payload: error });
        this.#actorEventSubscribers.forEach((subscribers, actorId) => {
          const event: TWidgetActorEvent = {
            kind: 'system',
            actorId,
            type: 'error',
            code: 'ACTOR_EVENT_STREAM_DISCONNECTED',
            message: 'Widget actor updates were disconnected. Reconnecting…',
          };
          subscribers.forEach((handler) => handler(event));
        });
      }
      if (!this.#isActorEventListenerRunning) return;
      await new Promise<void>((resolve) => {
        this.#resolveReconnectWait = resolve;
        this.#reconnectTimer = this.#browser.setTimeout(() => {
          this.#reconnectTimer = null;
          this.#resolveReconnectWait = null;
          resolve();
        }, delay);
      });
      delay = Math.min(delay * 2, 5_000);
    }
  }

  #closeActorEventIterator(iterator: AsyncIterator<unknown> | null) {
    if (!iterator?.return) return;
    try {
      const closing = iterator.return();
      if (closing) void Promise.resolve(closing).catch(() => undefined);
    } catch {
      // Stream cleanup must remain safe when an iterator closes synchronously.
    }
  }

  #getWidgetElementIds(kind?: string) {
    return Object.values(this.#crdtService.doc().elements).flatMap((element) => {
      if (element.data.type !== 'widget' && element.data.type !== 'ui-widget') return [];
      if (kind !== undefined && element.data.kind !== kind) return [];
      return [element.id];
    });
  }

  #invalidateElements(elementIds: readonly string[]) {
    if (elementIds.length === 0) return;
    this.runtimeHooks.elementDefinitionInvalidated.call({ elementIds });
  }

  #removeWidgetRegistration(kind: string) {
    this.#registeredWidgetKinds.delete(kind);
    this.#registeredWidgetConfigs.delete(kind);
    this.#toolService.unregisterTool(this.#registeredToolIdsByKind.get(kind) ?? kind);
    this.#registeredToolIdsByKind.delete(kind);
    this.#elementService.unregisterElement(kind);
  }

  getWidgetError(element: TElement): TWidgetError | null {
    const kind = element.data.type === 'widget' || element.data.type === 'ui-widget' ? element.data.kind : 'unknown';
    const error = this.#elementErrors.get(element.id)
      ?? this.#definitionErrors.get(kind)
      ?? this.#globalDefinitionError;
    if (error) return error;
    if (!this.#definitionDiscoveryComplete) return null;
    return { phase: 'definition-fetch', code: 'WIDGET_DEFINITION_UNAVAILABLE', message: `Widget definition "${kind}" is unavailable.`, retryable: true };
  }

  completeDefinitionDiscovery() {
    if (this.#definitionDiscoveryComplete) return;
    this.#definitionDiscoveryComplete = true;
    this.#invalidateElements(this.#getWidgetElementIds());
  }

  setGlobalDefinitionError(error: TWidgetError | null) {
    if (fnWidgetErrorsEqual(this.#globalDefinitionError, error)) return;
    this.#globalDefinitionError = error;
    this.#invalidateElements(this.#getWidgetElementIds());
  }

  setDefinitionError(kind: string, error: TWidgetError) {
    this.#definitionErrors.set(kind, error);
    this.#invalidateElements(this.#getWidgetElementIds(kind));
  }

  clearDefinitionError(kind: string) {
    this.#definitionErrors.delete(kind);
  }

  setElementError(elementId: string, error: TWidgetError) {
    this.#elementErrors.set(elementId, error);
    const element = this.#crdtService.doc().elements[elementId];
    if (element?.data.type === 'widget' || element?.data.type === 'ui-widget') {
      this.#invalidateElements([elementId]);
    }
  }

  clearElementError(elementId: string) {
    this.#elementErrors.delete(elementId);
    const element = this.#crdtService.doc().elements[elementId];
    if (element?.data.type === 'widget' || element?.data.type === 'ui-widget') {
      this.#invalidateElements([elementId]);
    }
  }

  #registerFallbackWidgetDefinition() {
    this.#elementService.registerElement({
      id: '__widget-error-fallback',
      priority: 20_000,
      matchesElement: (element) => {
        return (element.data.type === 'widget' || element.data.type === 'ui-widget')
          && !this.#registeredWidgetKinds.has(element.data.kind);
      },
      matchesNode: (node) => {
        const data = node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | TUiWidgetData | undefined;
        return (data?.type === 'widget' || data?.type === 'ui-widget') && !this.#registeredWidgetKinds.has(data.kind);
      },
      toElement: (node) => fnToWidgetElement(node, this.#browser.now()),
      createNode: (element) => {
        if (element.data.type !== 'widget' && element.data.type !== 'ui-widget') return null;
        const colors = fnGetHostThemeColors(this.#themeService, element.data.type);
        const node = fnCreateWidgetNode(Konva, colors, element, { label: element.data.kind });
        const onRemove = txAttachDomPortal({
          node,
          widgetPortal: this.#widgetPortal,
          document: this.#browser.document,
          browser: this.#browser,
          widgetServie: this,
          cameraService: this.#cameraService,
          sceneService: this.#sceneService,
          selectionService: this.#selectionService,
          themeService: this.#themeService,
          hostColors: colors,
          fullscreenHostActions: node ? this.#createFullscreenHostActions(node) : undefined,
          transport: this.#transport,
        }, { element });
        if (node && onRemove) {
          node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, onRemove.syncDiv);
          node.setAttr(VC_ON_REMOVE_ATTR, () => onRemove());
        }
        return node;
      },
      getTransformOptions: () => ({ flipEnabled: false, keepRatio: false }),
      onResize: ({ node, element, anchors }) => {
        if (element.data.type !== 'widget' && element.data.type !== 'ui-widget') return;
        txResizeWidgetHost({ Circle: Konva.Circle, Group: Konva.Group, Line: Konva.Line, Rect: Konva.Rect, Text: Konva.Text }, { node, anchors });
        this.#syncWidgetDomPortal(node);
        return { cancel: true, crdt: false };
      },
      attachListeners: (node) => fxAttachWidgetListener({
        node,
        Circle: Konva.Circle,
        Group: Konva.Group,
        Line: Konva.Line,
        Rect: Konva.Rect,
        hooks: this.runtimeHooks,
        selection: this.#selectionService,
        toElement: (candidateNode) => this.#elementService.toElement(candidateNode),
        crdtService: this.#crdtService,
        startDragClone: (args) => this.#elementService.createDragClone(args),
        removeWidget: (removeNode) => this.#removeWidgetNode(removeNode, { recordHistory: true }),
        openWidgetMenu: (args) => this.#openWidgetHeaderMenu(args),
        closeWidgetMenu: () => this.#contextMenuService.close(),
        setTimer: (callback, timeout) => this.#browser.setInterval(callback, timeout),
        clearTimer: (timer) => this.#browser.clearInterval(timer),
      }, {}),
    });
  }

  #routeActorEvent(event: TWidgetActorEvent) {
    const subscribers = this.#actorEventSubscribers.get(event.actorId);
    if (!subscribers) return;

    subscribers.forEach((handler) => handler(event));
  }

  subscribeActorInstanceEvents(actorInstanceId: string, handler: TWidgetActorEventHandler) {
    let subscribers = this.#actorEventSubscribers.get(actorInstanceId);
    if (!subscribers) {
      subscribers = new Set();
      this.#actorEventSubscribers.set(actorInstanceId, subscribers);
    }

    subscribers.add(handler);

    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) {
        this.#actorEventSubscribers.delete(actorInstanceId);
      }
    };
  }

  #findWidgetNodeById(id: string) {
    const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Group && candidate.id() === id;
    });

    return node instanceof Konva.Group ? node : null;
  }

  #removeWidgetNode(node: Konva.Node, args: { recordHistory: boolean }) {
    const element = this.#elementService.toElement(node);
    if (!element || (element.data.type !== "widget" && element.data.type !== "ui-widget")) {
      return false;
    }

    this.#contextMenuService.close();
    const commitResult = this.#elementService.removeElement(node, this.#crdtService.build()).commit();
    this.#selectionService.clear();
    this.#sceneService.staticForegroundLayer.batchDraw();

    if (!args.recordHistory || !this.#historyService) {
      return true;
    }

    this.#historyService.record({
      label: "remove-widget",
      undo: () => {
        commitResult.rollback();
        const restoredNode = this.#elementService.createNodeFromElement(element);
        if (!(restoredNode instanceof Konva.Group)) {
          return;
        }

        this.#sceneService.staticForegroundLayer.add(restoredNode);
        this.#elementService.updateElement(element);
        this.#renderOrderService.sortChildren(this.#sceneService.staticForegroundLayer);
        this.#selectionService.setSelection([restoredNode]);
        this.#selectionService.setFocusedNode(restoredNode);
        this.#sceneService.staticForegroundLayer.batchDraw();
      },
      redo: () => {
        const redoNode = this.#findWidgetNodeById(element.id);
        if (redoNode) {
          this.#removeWidgetNode(redoNode, { recordHistory: false });
          return;
        }

        this.#crdtService.applyOps({ ops: commitResult.redoOps });
        this.#selectionService.clear();
        this.#sceneService.staticForegroundLayer.batchDraw();
      },
    });

    return true;
  }

  async #deleteWidgetDefinition(kind: string) {
    this.#contextMenuService.close();
    const confirmed = await this.#confirmDialogService.confirm({
      title: "Delete widget",
      description: `Delete the published widget "${kind}"? This removes all current canvas instances and unregisters the widget from the toolbar. This action cannot be undone.`,
      confirmLabel: "Delete widget",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!confirmed) {
      return false;
    }

    const [error] = await this.#transport.api.actors.definitions.delete({ name: kind });
    if (error) {
      this.#loggingService.warn({
        kind: "service",
        name: this.name,
        level: 1,
        event: "delete-widget-definition-failed",
        payload: error,
      });
      return false;
    }

    const doc = this.#crdtService.doc();
    const matchingElements = Object.values(doc.elements).filter((element) => {
      return element.data.type === "widget" && element.data.kind === kind;
    });

    if (matchingElements.length > 0) {
      let builder = this.#crdtService.build();
      matchingElements.forEach((element) => {
        const node = this.#findWidgetNodeById(element.id);
        if (node) {
          builder = this.#elementService.removeElement(node, builder);
          return;
        }

        builder.deleteElement(element.id);
      });
      builder.commit();
    }

    this.unregisterWidget(kind);
    this.#selectionService.clear();
    this.#sceneService.staticForegroundLayer.batchDraw();
    return true;
  }

  #syncWidgetDomPortal(node: Konva.Node) {
    const syncWidgetDomPortal = node.getAttr(WIDGET_DOM_PORTAL_SYNC_ATTR) as TWidgetDomPortalSync | undefined;
    syncWidgetDomPortal?.();
  }

  #setWidgetExpanded(node: Konva.Group, expanded: boolean) {
    const body = node.findOne(`#${WIDGET_HOST_BODY_ID}`);
    if (body instanceof Konva.Rect) {
      body.visible(expanded);
      body.listening(expanded);
    }

    const border = node.findOne(`#${WIDGET_HOST_BORDER_ID}`);
    if (border instanceof Konva.Rect) {
      border.height(expanded ? node.height() : WIDGET_HOST_HEADER_HEIGHT);
    }

    const divider = node.findOne(`#${WIDGET_HOST_DIVIDER_ID}`);
    if (divider instanceof Konva.Rect) {
      divider.visible(expanded);
      divider.listening(false);
    }

    const header = node.findOne(`#${WIDGET_HOST_HEADER_ID}`);
    if (header instanceof Konva.Rect) {
      header.cornerRadius([WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0]);
    }

    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type === "widget" || widgetData?.type === "ui-widget") {
      node.setAttr(ELEMENT_DATA_ATTR, {
        ...widgetData,
        expanded,
      });
    }

    this.#syncWidgetDomPortal(node);
    node.getLayer()?.batchDraw();
  }

  #setWidgetWindowMode(node: Konva.Group, windowMode: typeof WIDGET_WINDOW_CONTAINED | typeof WIDGET_WINDOW_FULLSCREEN) {
    if (windowMode === WIDGET_WINDOW_FULLSCREEN) {
      if (this.#selectionService.selection.length > 0) {
        this.#selectionService.setSelection([]);
      }

      if (this.#selectionService.focusedId !== node.id()) {
        this.#selectionService.setFocusedId(node.id());
      }
    }

    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type === "widget" || widgetData?.type === "ui-widget") {
      node.setAttr(ELEMENT_DATA_ATTR, {
        ...widgetData,
        window: windowMode,
      });
    }

    this.#syncWidgetDomPortal(node);
    node.getLayer()?.batchDraw();
  }

  #minimizeFullscreenWidget(node: Konva.Group) {
    this.#contextMenuService.close();
    this.#setWidgetWindowMode(node, WIDGET_WINDOW_CONTAINED);
    this.#setWidgetExpanded(node, false);
  }

  #exitWidgetFullscreen(node: Konva.Group) {
    this.#contextMenuService.close();
    this.#setWidgetWindowMode(node, WIDGET_WINDOW_CONTAINED);
  }

  #createFullscreenHostActions(node: Konva.Group): TWidgetFullscreenHostActions {
    return {
      close: () => {
        this.#removeWidgetNode(node, { recordHistory: true });
      },
      minimize: () => this.#minimizeFullscreenWidget(node),
      exitFullscreen: () => this.#exitWidgetFullscreen(node),
      openMenu: ({ anchor }) => this.#openWidgetHeaderMenu({ node, anchor }),
      closeMenu: () => this.#contextMenuService.close(),
    };
  }

  #openWidgetHeaderMenu(args: {
    node: Konva.Group;
    anchor: {
      x: number;
      y: number;
    };
  }) {
    const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined;
    if (widgetData?.type !== "widget" && widgetData?.type !== "ui-widget") {
      return;
    }

    this.#selectionService.setSelection([args.node]);
    const deleteActions = widgetData.type === "widget"
      ? [
        {
          id: "widget-delete-instance",
          label: "Delete instance",
          priority: 30,
          onSelect: () => {
            this.#removeWidgetNode(args.node, { recordHistory: true });
          },
        },
        {
          id: "widget-delete-definition",
          label: "Delete widget",
          priority: 40,
          onSelect: () => {
            void this.#deleteWidgetDefinition(widgetData.kind);
          },
        },
      ]
      : [
        {
          id: "widget-delete-instance",
          label: "Delete instance",
          priority: 30,
          onSelect: () => {
            this.#removeWidgetNode(args.node, { recordHistory: true });
          },
        },
      ];

    this.#contextMenuService.openWithActionsAt({
      x: args.anchor.x,
      y: args.anchor.y,
      actions: [
        {
          id: "widget-toggle-expanded",
          label: widgetData.expanded === false ? "Restore" : "Minimize",
          priority: 10,
          onSelect: () => {
            this.#contextMenuService.close();
            if (widgetData.window === WIDGET_WINDOW_FULLSCREEN && widgetData.expanded !== false) {
              this.#minimizeFullscreenWidget(args.node);
              return;
            }
            this.#setWidgetExpanded(args.node, widgetData.expanded === false);
          },
        },
        {
          id: "widget-toggle-fullscreen",
          label: widgetData.window === WIDGET_WINDOW_FULLSCREEN ? "Exit fullscreen" : "Fullscreen",
          priority: 20,
          onSelect: () => {
            this.#contextMenuService.close();
            this.#setWidgetWindowMode(
              args.node,
              widgetData.window === WIDGET_WINDOW_FULLSCREEN
                ? WIDGET_WINDOW_CONTAINED
                : WIDGET_WINDOW_FULLSCREEN,
            );
          },
        },
        ...deleteActions,
      ],
    });
  }

  unregisterWidget(kind: string) {
    this.#removeWidgetRegistration(kind);
    if (this.#isActorEventListenerRunning) {
      this.#invalidateElements(this.#getWidgetElementIds(kind));
    }
  }

  registerWidget(wConfig: IWidgetConfig) {
    this.#removeWidgetRegistration(wConfig.id);
    this.#registeredWidgetKinds.add(wConfig.id);
    this.#registeredWidgetConfigs.set(wConfig.id, wConfig);
    this.#registeredToolIdsByKind.set(wConfig.id, wConfig.toolId ?? wConfig.id);
    this.clearDefinitionError(wConfig.id);

    if (wConfig.tool) {
      fxRegisterWidgetTool({
        toolService: this.#toolService,
        konva: Konva,
        themeService: this.#themeService,
        createId: () => this.#browser.createId(),
        now: () => this.#browser.now(),
      }, { widgetConfig: wConfig })
    }

    this.#elementService.registerElement({
      id: wConfig.id,
      toElement: (node) => fnToWidgetElement(node, this.#browser.now()),
      matchesNode: (node) => {
        const data = node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | TUiWidgetData | undefined;
        return (data?.type === 'widget' || data?.type === 'ui-widget') && data.kind === wConfig.id;
      },
      matchesElement: (element) => (element.data.type === "widget" || element.data.type === "ui-widget") && element.data.kind === wConfig.id,
      createNode: (element) => {
        const colors = fnGetHostThemeColors(this.#themeService, wConfig.dataType ?? 'ui-widget')
        const node = fnCreateWidgetNode(Konva, colors, element, {
          label: wConfig.getTitle?.(element) ?? wConfig.tool?.label,
        })
        const onRemove = txAttachDomPortal({
          node,
          widgetPortal: this.#widgetPortal,
          document: this.#browser.document,
          browser: this.#browser,
          widgetServie: this,
          cameraService: this.#cameraService,
          sceneService: this.#sceneService,
          selectionService: this.#selectionService,
          themeService: this.#themeService,
          hostColors: colors,
          fullscreenHostActions: node ? this.#createFullscreenHostActions(node) : undefined,
          widgetConfig: wConfig,
          transport: this.#transport,
        }, {element})
        if (node && onRemove) {
          node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, onRemove.syncDiv);
          const existingOnRemove = node.getAttr(VC_ON_REMOVE_ATTR) as TNodeOnRemove | undefined;
          node.setAttr(VC_ON_REMOVE_ATTR, (removeArgs: { node: unknown }) => {
            existingOnRemove?.(removeArgs);
            onRemove();
          });
        }
        return node
      },
      onDelete: (element) => {
        if (element.data.type !== "widget" || element.data.kind !== wConfig.id) {
          return {};
        }

        return {};
      },
      updateElement: (element) => {
        if ((element.data.type !== "widget" && element.data.type !== "ui-widget") || element.data.kind !== wConfig.id) {
          return false;
        }

        const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return candidate.id() === element.id;
        });
        if (!node) {
          return false;
        }

        const colors = fnGetHostThemeColors(this.#themeService, wConfig.dataType ?? 'ui-widget');
        const didUpdate = txUpdateWidgetNodeFromElement({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
          Text: Konva.Text,
        }, {
          node,
          element,
          label: wConfig.getTitle?.(element) ?? wConfig.tool?.label,
          labelFill: colors.headerTitleFill,
          hostColors: colors,
        });
        return didUpdate;
      },
      createDragClone: wConfig.cloneable === false ? undefined : ({ node }) => {
        if (!this.#historyService) {
          return false;
        }

        return txCreateWidgetCloneDrag({
          Group: Konva.Group,
          crdt: this.#crdtService,
          element: this.#elementService,
          history: this.#historyService,
          renderOrder: this.#renderOrderService,
          scene: this.#sceneService,
          selection: this.#selectionService,
          createId: () => this.#browser.createId(),
          createNode: (candidateElement) => {
            const candidateNode = this.#elementService.createNodeFromElement(candidateElement);
            return candidateNode instanceof Konva.Group ? candidateNode : null;
          },
          now: () => this.#browser.now(),
          clone: <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
          cloneUiWidgetPayload: wConfig.createClonePayload,
          setupNode: (candidateNode) => {
            return fxAttachWidgetListener({
              node: candidateNode,
              Circle: Konva.Circle,
              Group: Konva.Group,
              Line: Konva.Line,
              Rect: Konva.Rect,
              hooks: this.runtimeHooks,
              selection: this.#selectionService,
              toElement: (candidate) => this.#elementService.toElement(candidate),
              crdtService: this.#crdtService,
              startDragClone: (cloneArgs) => this.#elementService.createDragClone(cloneArgs),
              removeWidget: (removeNode) => this.#removeWidgetNode(removeNode, { recordHistory: true }),
              openWidgetMenu: (menuArgs) => this.#openWidgetHeaderMenu(menuArgs),
              closeWidgetMenu: () => this.#contextMenuService.close(),
              setTimer: (callback, timeout) => this.#browser.setInterval(callback, timeout),
              clearTimer: (timer) => this.#browser.clearInterval(timer),
            }, {})
          },
        }, { node });
      },
      getTransformOptions(args) {
        return {
          flipEnabled: false,
          keepRatio: false,
          boundBoxFunc: (oldBox, newBox) => {
            if (newBox.width < WIDGET_HOST_MIN_WIDTH || newBox.height < WIDGET_HOST_MIN_HEIGHT) {
              return oldBox;
            }

            return newBox;
          },
        }
      },
      onResize: ({ node, element, anchors }) => {
        if (element.data.type !== "widget" && element.data.type !== "ui-widget") return;

        txResizeWidgetHost({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
          Text: Konva.Text,
        }, {
          node,
          anchors,
        });
        const syncWidgetDomPortal = node.getAttr(WIDGET_DOM_PORTAL_SYNC_ATTR) as TWidgetDomPortalSync | undefined;
        syncWidgetDomPortal?.();

        return {
          cancel: true,
          crdt: false,
        };
      },

      attachListeners: (node) => fxAttachWidgetListener({
        node,
        Circle: Konva.Circle,
        Group: Konva.Group,
        Line: Konva.Line,
        Rect: Konva.Rect,
        hooks: this.runtimeHooks,
        selection: this.#selectionService,
        toElement: (candidateNode) => this.#elementService.toElement(candidateNode),
        crdtService: this.#crdtService,
        startDragClone: (args) => this.#elementService.createDragClone(args),
        removeWidget: (removeNode) => this.#removeWidgetNode(removeNode, { recordHistory: true }),
        openWidgetMenu: (args) => this.#openWidgetHeaderMenu(args),
        closeWidgetMenu: () => this.#contextMenuService.close(),
        setTimer: (callback, timeout) => this.#browser.setInterval(callback, timeout),
        clearTimer: (timer) => this.#browser.clearInterval(timer),
      }, {})
    })
    if (this.#isActorEventListenerRunning) {
      this.#invalidateElements(this.#getWidgetElementIds(wConfig.id));
    }

  }

  registerPlacementTool(args: {
    id: string;
    label: string;
    tone?: "draft";
    icon?: string;
    group?: string;
    priority?: number;
    placement: TWidgetDropRequest;
  }) {
    this.#toolService.registerTool({
      id: args.id,
      label: args.label,
      tone: args.tone,
      icon: args.icon,
      group: args.group,
      priority: args.priority,
      behavior: { type: "mode", mode: "draw-create" },
      widgetPlacement: args.placement,
    });
  }

  unregisterPlacementTool(id: string) {
    this.#toolService.unregisterTool(id);
  }

  placePublishedWidget(kind: string, bounds: TWidgetWorldBounds) {
    const config = this.#registeredWidgetConfigs.get(kind);
    if (!config || config.dataType !== "widget" || !config.actor) {
      throw new Error(`Published widget definition '${kind}' is unavailable.`);
    }
    const timestamp = this.#browser.now();
    const element = fnCreateWidgetElement({
      id: this.#browser.createId(),
      kind,
      dataType: "widget",
      actorDefinitionName: config.actor.actorDefinitionName,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      now: timestamp,
    });
    const node = this.#elementService.createNodeFromElement(element);
    if (!(node instanceof Konva.Group)) throw new Error(`Published widget '${kind}' could not be created.`);
    this.#sceneService.staticForegroundLayer.add(node);
    this.#renderOrderService.assignOrderOnInsert({
      parent: this.#sceneService.staticForegroundLayer,
      nodes: [node],
      position: "front",
    });
    const persisted = this.#elementService.toElement(node);
    if (!persisted) {
      node.destroy();
      throw new Error(`Published widget '${kind}' could not be persisted.`);
    }
    const commitResult = this.#crdtService.build().patchElement(persisted.id, persisted).commit();
    this.#toolService.setActiveTool("select");
    this.#selectionService.setSelection([node]);
    this.#selectionService.setFocusedNode(node);
    this.#sceneService.staticForegroundLayer.batchDraw();
    if (this.#historyService) {
      let currentNode: Konva.Group | undefined = node;
      this.#historyService.record({
        label: "create-widget",
        undo: () => {
          const candidate = currentNode ?? this.#findWidgetNodeById(persisted.id) ?? undefined;
          if (candidate) {
            const onRemove = candidate.getAttr(VC_ON_REMOVE_ATTR) as TNodeOnRemove | undefined;
            onRemove?.({ node: candidate });
            candidate.destroy();
          }
          currentNode = undefined;
          commitResult.rollback();
          this.#selectionService.clear();
          this.#sceneService.staticForegroundLayer.batchDraw();
        },
        redo: () => {
          const restored = this.#elementService.createNodeFromElement(persisted);
          if (!(restored instanceof Konva.Group)) return;
          this.#sceneService.staticForegroundLayer.add(restored);
          this.#elementService.updateElement(persisted);
          this.#renderOrderService.sortChildren(this.#sceneService.staticForegroundLayer);
          this.#crdtService.applyOps({ ops: commitResult.redoOps });
          this.#selectionService.setSelection([restored]);
          this.#selectionService.setFocusedNode(restored);
          this.#sceneService.staticForegroundLayer.batchDraw();
          currentNode = restored;
        },
      });
    }
    return persisted;
  }

}
