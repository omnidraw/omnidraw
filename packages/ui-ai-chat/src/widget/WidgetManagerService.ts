import type { IService, IStartableService } from "@vibecanvas/runtime";
import type { IServiceContext, IStoppableService } from "@vibecanvas/runtime/interface.js";
import type { TUiWidgetData, TWidgetData, TWidgetInstanceData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { CameraService, ConfirmDialogService, ContextMenuService, CrdtService, ElementService, HistoryService, RenderOrderService, SceneService, SelectionService, ToolService } from "@vibecanvas/canvas/services";
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
import type { TElement } from '@vibecanvas/service-automerge/types/canvas-doc.types';
import type { TWidgetError } from '@vibecanvas/service-db/model';
import type { TWidgetBrowserPort } from "../ports";
import type { TWidgetDropRequest, TWidgetWorldBounds } from "@vibecanvas/canvas/services";
import { fnCreateWidgetElement } from "./fn.create-widget-element";
import { fnWidgetErrorsEqual } from "./fn.widget-errors-equal";
import type { TWidgetHostData } from '@vibecanvas/canvas/widget-host/types';
import { fnIsWidgetHostData, fnNormalizeWidgetHostData } from '@vibecanvas/canvas/widget-host/fn.normalize-widget-host-data';
import { txMountCommittedWidgetRuntime } from './tx.mount-committed-widget-runtime';
import type {
  TLegacyWidgetRuntimeAdapter,
  TLegacyWidgetSandboxMountArgs,
} from '../legacy';

type TWidgetDomPortalSync = () => void;
type TNodeOnRemove = (args: { node: unknown }) => void;

export class WidgetManagerService implements IService<IWidgetManagerServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = "widget-manager";
  #crdtService: CrdtService;
  #historyService?: HistoryService;
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
  #legacyActorAdapter: TLegacyWidgetRuntimeAdapter | undefined;
  #neutralHost: IWidgetManagerServiceProps['neutralHost'];
  #started = false;
  #registeredWidgetKinds = new Set<string>();
  #registeredWidgetConfigs = new Map<string, IWidgetConfig>();
  #registeredToolIdsByKind = new Map<string, string>();
  #definitionErrors = new Map<string, TWidgetError>();
  #elementErrors = new Map<string, TWidgetError>();
  #globalDefinitionError: TWidgetError | null = null;
  #definitionDiscoveryComplete = false;
  #neutralPortalCleanups = new Set<() => void>();

  private readonly runtimeHooks!: IRuntimeHooks;


  constructor(props: IWidgetManagerServiceProps) {
    this.#crdtService = props.crdtService;
    this.#historyService = props.historyService;
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
    this.#neutralHost = props.neutralHost;
    this.#legacyActorAdapter = props.legacy;
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
    this.#registerNeutralWidgetDefinition();
    this.#started = true;
    if ([...this.#registeredWidgetConfigs.values()].some((config) => config.dataType === 'widget' && config.actor)) {
      this.#legacyActorAdapter?.start();
    }
  }

  stop(): void | Promise<void> {
    this.#started = false;
    this.#legacyActorAdapter?.stop();
    [...this.#neutralPortalCleanups].forEach((cleanup) => cleanup());
    this.#neutralPortalCleanups.clear();
    this.#removeSelectionChangeListener?.();
    this.#removeSelectionChangeListener = undefined;
    this.#contextMenuService.close();
    this.#widgetPortal.remove()
  }


  #getWidgetElementIds(kind?: string) {
    return Object.values(this.#crdtService.doc().elements).flatMap((element) => {
      const host = fnNormalizeWidgetHostData(element.data);
      if (!host) return [];
      if (kind !== undefined && host.hostKey !== kind) return [];
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
    if (element.data.type === 'widget-instance') return null;
    const kind = fnNormalizeWidgetHostData(element.data)?.hostKey ?? 'unknown';
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
    if (element && fnIsWidgetHostData(element.data)) {
      this.#invalidateElements([elementId]);
    }
  }

  clearElementError(elementId: string) {
    this.#elementErrors.delete(elementId);
    const element = this.#crdtService.doc().elements[elementId];
    if (element && fnIsWidgetHostData(element.data)) {
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

  #registerNeutralWidgetDefinition() {
    this.#elementService.registerElement({
      id: '__widget-instance-host',
      matchesElement: (element) => element.data.type === 'widget-instance',
      matchesNode: (node) => {
        const data = node.getAttr(ELEMENT_DATA_ATTR) as TWidgetInstanceData | undefined;
        return data?.type === 'widget-instance';
      },
      toElement: (node) => fnToWidgetElement(node, this.#browser.now()),
      createNode: (element) => {
        if (element.data.type !== 'widget-instance') return null;
        const colors = fnGetHostThemeColors(this.#themeService, 'widget-instance');
        const widgetConfig: IWidgetConfig = {
          id: element.data.definitionId,
          getTitle: (candidate) => candidate.data.type === 'widget-instance'
            ? candidate.data.definitionId
            : 'Widget',
          renderDom: this.#neutralHost
            ? ({ root, element: candidate }) => txMountCommittedWidgetRuntime({
                canvasId: this.#neutralHost!.canvasId,
                crdtService: this.#crdtService,
                runtime: this.#neutralHost!.runtime,
              }, {
                elementId: candidate.id,
                root,
              })
            : undefined,
        };
        const node = fnCreateWidgetNode(Konva, colors, element, {
          label: element.data.definitionId,
        });
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
          widgetConfig,
        }, { element });
        if (node && onRemove) {
          node.setAttr(WIDGET_DOM_PORTAL_SYNC_ATTR, onRemove.syncDiv);
          const existingOnRemove = node.getAttr(VC_ON_REMOVE_ATTR) as TNodeOnRemove | undefined;
          const cleanupPortal = () => {
            this.#neutralPortalCleanups.delete(cleanupPortal);
            onRemove();
          };
          this.#neutralPortalCleanups.add(cleanupPortal);
          node.setAttr(VC_ON_REMOVE_ATTR, (removeArgs: { node: unknown }) => {
            existingOnRemove?.(removeArgs);
            cleanupPortal();
          });
        }
        return node;
      },
      updateElement: (element) => {
        if (element.data.type !== 'widget-instance') return false;
        const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return candidate.id() === element.id;
        });
        if (!node) return false;
        const colors = fnGetHostThemeColors(this.#themeService, 'widget-instance');
        return txUpdateWidgetNodeFromElement({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
          Text: Konva.Text,
        }, {
          node,
          element,
          label: element.data.definitionId,
          labelFill: colors.headerTitleFill,
          hostColors: colors,
        });
      },
      createDragClone: ({ node }) => {
        if (!this.#historyService) return false;
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
          setupNode: (candidateNode) => fxAttachWidgetListener({
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
          }, {}),
        }, { node });
      },
      getTransformOptions: () => ({
        flipEnabled: false,
        keepRatio: false,
        boundBoxFunc: (oldBox, newBox) => {
          if (newBox.width < WIDGET_HOST_MIN_WIDTH || newBox.height < WIDGET_HOST_MIN_HEIGHT) {
            return oldBox;
          }
          return newBox;
        },
      }),
      onResize: ({ node, element, anchors }) => {
        if (element.data.type !== 'widget-instance') return;
        txResizeWidgetHost({
          Circle: Konva.Circle,
          Group: Konva.Group,
          Line: Konva.Line,
          Rect: Konva.Rect,
          Text: Konva.Text,
        }, { node, anchors });
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

  mountLegacyWidgetSandbox(args: TLegacyWidgetSandboxMountArgs): () => void {
    if (!this.#legacyActorAdapter) {
      throw new Error('Legacy actor widgets are disabled in this host.');
    }
    return this.#legacyActorAdapter.mountSandbox(args);
  }

  #findWidgetNodeById(id: string) {
    const node = this.#sceneService.staticForegroundLayer.findOne((candidate: Konva.Node) => {
      return candidate instanceof Konva.Group && candidate.id() === id;
    });

    return node instanceof Konva.Group ? node : null;
  }

  #removeWidgetNode(node: Konva.Node, args: { recordHistory: boolean }) {
    const element = this.#elementService.toElement(node);
    if (!element || !fnIsWidgetHostData(element.data)) {
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

    if (!this.#legacyActorAdapter || !await this.#legacyActorAdapter.deleteDefinition(kind)) return false;

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

  async deleteWidgetInstanceDefinition(definitionId: string) {
    const deleteDefinition = this.#neutralHost?.deleteDefinition;
    if (!deleteDefinition) return false;
    this.#contextMenuService.close();
    const confirmed = await this.#confirmDialogService.confirm({
      title: 'Delete widget',
      description: 'Delete this published widget definition and all of its current canvas instances? This action cannot be undone.',
      confirmLabel: 'Delete widget',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!confirmed || !await deleteDefinition({ definitionId })) return false;

    const matchingElements = Object.values(this.#crdtService.doc().elements).filter((element) => {
      return element.data.type === 'widget-instance' && element.data.definitionId === definitionId;
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

    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TWidgetHostData | undefined;
    if (widgetData && fnIsWidgetHostData(widgetData)) {
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

    const widgetData = node.getAttr(ELEMENT_DATA_ATTR) as TWidgetHostData | undefined;
    if (widgetData && fnIsWidgetHostData(widgetData)) {
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
    const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetHostData | undefined;
    if (!widgetData || !fnIsWidgetHostData(widgetData)) {
      return;
    }

    this.#selectionService.setSelection([args.node]);
    const deleteInstanceAction = {
      id: "widget-delete-instance",
      label: "Delete instance",
      priority: 30,
      onSelect: () => {
        this.#removeWidgetNode(args.node, { recordHistory: true });
      },
    };
    const deleteActions = widgetData.type === "widget"
      ? [
        deleteInstanceAction,
        {
          id: "widget-delete-definition",
          label: "Delete widget",
          priority: 40,
          onSelect: () => {
            void this.#deleteWidgetDefinition(widgetData.kind);
          },
        },
      ]
      : widgetData.type === 'widget-instance' && this.#neutralHost?.deleteDefinition
        ? [
            deleteInstanceAction,
            {
              id: 'widget-delete-definition',
              label: 'Delete widget',
              priority: 40,
              onSelect: () => {
                void this.deleteWidgetInstanceDefinition(widgetData.definitionId);
              },
            },
          ]
        : [deleteInstanceAction];

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
    if (this.#started) {
      this.#invalidateElements(this.#getWidgetElementIds(kind));
    }
  }

  registerWidget(wConfig: IWidgetConfig) {
    this.#removeWidgetRegistration(wConfig.id);
    this.#registeredWidgetKinds.add(wConfig.id);
    this.#registeredWidgetConfigs.set(wConfig.id, wConfig);
    this.#registeredToolIdsByKind.set(wConfig.id, wConfig.toolId ?? wConfig.id);
    this.clearDefinitionError(wConfig.id);
    if (this.#started && wConfig.dataType === 'widget' && wConfig.actor) {
      this.#legacyActorAdapter?.start();
    }

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
    if (this.#started) {
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

  placeLegacyPublishedWidget(kind: string, bounds: TWidgetWorldBounds) {
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
    return this.#placeWidgetElement(element, `Published widget '${kind}'`);
  }

  placeWidgetInstance(args: Readonly<{
    definitionId: string;
    revisionId: string;
    bounds: TWidgetWorldBounds;
    instanceId?: string;
    stateDocumentId?: string;
  }>) {
    const timestamp = this.#browser.now();
    const element = fnCreateWidgetElement({
      id: this.#browser.createId(),
      dataType: 'widget-instance',
      definitionId: args.definitionId,
      revisionId: args.revisionId,
      instanceId: args.instanceId ?? this.#browser.createId(),
      ...(args.stateDocumentId === undefined
        ? {}
        : { stateDocumentId: args.stateDocumentId }),
      x: args.bounds.x,
      y: args.bounds.y,
      width: args.bounds.width,
      height: args.bounds.height,
      now: timestamp,
    });
    return this.#placeWidgetElement(element, `Widget definition '${args.definitionId}'`);
  }

  #placeWidgetElement(element: TElement, errorLabel: string) {
    const node = this.#elementService.createNodeFromElement(element);
    if (!(node instanceof Konva.Group)) throw new Error(`${errorLabel} could not be created.`);
    this.#sceneService.staticForegroundLayer.add(node);
    this.#renderOrderService.assignOrderOnInsert({
      parent: this.#sceneService.staticForegroundLayer,
      nodes: [node],
      position: "front",
    });
    const persisted = this.#elementService.toElement(node);
    if (!persisted) {
      node.destroy();
      throw new Error(`${errorLabel} could not be persisted.`);
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
