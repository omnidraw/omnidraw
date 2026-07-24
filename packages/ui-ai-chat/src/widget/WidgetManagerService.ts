import type {
  IService,
  IStartableService,
  IStoppableService,
} from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TWidgetError } from "@vibecanvas/service-db/model";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  TElementPointerEvent,
} from "@vibecanvas/canvas";
import { SyncHook } from "@vibecanvas/tapable";
import type {
  TCanvasPortalRenderState,
  TCanvasPortalRendererMountArgs,
  TWidgetDropRequest,
  TWidgetWorldBounds,
} from "@vibecanvas/canvas/services";
import {
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
  WIDGET_WINDOW_CONTAINED,
  WIDGET_WINDOW_FULLSCREEN,
  WIDGET_WINDOW_MINIMIZED,
} from "./CONSTANTS";
import { fnCreateWidgetElement } from "./fn.create-widget-element";
import {
  fnIsWidgetElement,
  fnNextWidgetZIndex,
  fnWidgetCreationBounds,
} from "./fn.widget-frame";
import { fnWidgetErrorsEqual } from "./fn.widget-errors-equal";
import type {
  IWidgetConfig,
  IWidgetManagerServiceHooks,
  IWidgetManagerServiceProps,
  TWidgetTitleBarActionState,
  TWidgetTitleBarPortal,
} from "./interface";
import { txMountCommittedWidgetRuntime } from "./tx.mount-committed-widget-runtime";
import { txMountWidgetPortal } from "./tx.mount-widget-portal";

type TActiveMount = {
  elementId: string;
  state: TCanvasPortalRenderState;
  contentSignature: string;
  host: HTMLDivElement;
  actionHandlers: Map<string, () => void>;
  resizeBoundary: {
    enabled: boolean;
  };
  cleanup: () => void;
  syncInteraction(): void;
};

function exposesWidgetResizeBoundary(element: TElement): boolean {
  return (
    element.data.type === "ui-widget"
    || element.data.type === "widget-instance"
  ) && element.data.window !== "fullscreen";
}

export class WidgetManagerService
implements
  IService<IWidgetManagerServiceHooks>,
  IStartableService<IRuntimeHooks, IRuntimeConfig>,
  IStoppableService {
  readonly name = "widget-manager";
  readonly hooks: IWidgetManagerServiceHooks = {
    widgetChange: new SyncHook(),
  };

  readonly #props: IWidgetManagerServiceProps;
  readonly #registeredWidgetConfigs = new Map<string, IWidgetConfig>();
  readonly #registeredToolIdsByKind = new Map<string, string>();
  readonly #definitionErrors = new Map<string, TWidgetError>();
  readonly #elementErrors = new Map<string, TWidgetError>();
  readonly #titleActionStates = new Map<
    string,
    Map<string, TWidgetTitleBarActionState>
  >();
  readonly #activeMounts = new Set<TActiveMount>();
  readonly #cleanups: Array<() => void> = [];
  #globalDefinitionError: TWidgetError | null = null;
  #definitionDiscoveryComplete = false;
  #started = false;

  constructor(props: IWidgetManagerServiceProps) {
    this.#props = props;
  }

  start(ctx: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#cleanups.push(
      this.#props.elementService.registerElement({
        id: "__widget-product-policy",
        priority: 10_000,
        matchesElement: fnIsWidgetElement,
        getWidgetChrome: ({ element }) => {
          const config = this.#configFor(element);
          const actionStates = this.#titleActionStates.get(element.id);
          return {
            title: this.#titleFor(element, config),
            active: this.#isContentFocused(element.id),
            actions: element.data.type === "ui-widget"
              ? (config?.titleBarActions ?? []).map((action) => {
                  const state = actionStates?.get(action.id);
                  return {
                    ...action,
                    label: state?.label ?? action.label,
                    ...(state?.disabled === undefined
                      ? {}
                      : { disabled: state.disabled }),
                  };
                })
              : [],
          };
        },
        getTransformPolicy: ({ element }) => ({
          ...(fnIsWidgetElement(element)
              && element.data.window === WIDGET_WINDOW_FULLSCREEN
            ? { handles: [], allowRotate: false }
            : {}),
          allowFlip: false,
          keepAspectRatio: false,
          minSize: {
            width: WIDGET_HOST_MIN_WIDTH,
            height: WIDGET_HOST_MIN_HEIGHT,
          },
        }),
        prepareCloneData: ({ clone, createId }) => {
          if (clone.data.type !== "widget-instance") {
            return;
          }
          const { stateDocumentId: _stateDocumentId, ...data } = clone.data;
          void _stateDocumentId;
          return {
            ...data,
            instanceId: createId(),
          };
        },
      }),
      this.#props.portalService.registerRenderer({
        id: "ui-ai-chat:widget-content",
        priority: 100,
        matches: ({ content }) => {
          return content.type === "ui-widget"
            || content.type === "widget-instance";
        },
        mount: (args) => this.#mount(args),
      }),
      ctx.hooks.elementPointerDown.tap((event) => {
        return this.#handleSemanticWidgetClick(event);
      }),
      this.#props.selectionService.hooks.change.tap(() => {
        for (const mount of this.#activeMounts) {
          mount.syncInteraction();
        }
        this.#props.elementService.invalidateProjection();
      }),
    );
  }

  stop(): void {
    this.#started = false;
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      cleanup();
    }
    for (const mount of [...this.#activeMounts]) {
      mount.cleanup();
      mount.actionHandlers.clear();
    }
    this.#activeMounts.clear();
    this.#titleActionStates.clear();
    this.#props.contextMenuService.close();
  }

  #mount(args: TCanvasPortalRendererMountArgs) {
    const mount: TActiveMount = {
      elementId: args.element.id,
      state: { element: args.element, content: args.content },
      contentSignature: JSON.stringify(args.content),
      host: args.host,
      actionHandlers: new Map(),
      resizeBoundary: {
        enabled: exposesWidgetResizeBoundary(args.element),
      },
      cleanup: () => undefined,
      syncInteraction: () => {
        const active = this.#isContentFocused(mount.elementId);
        mount.resizeBoundary.enabled = exposesWidgetResizeBoundary(
          mount.state.element,
        );
        for (
          const root
          of mount.host.querySelectorAll<HTMLElement>(
            '[data-hosted-widget-root="true"]',
          )
        ) {
          root.style.pointerEvents = "auto";
          root.dataset.widgetContentFocused = String(active);
        }
      },
    };
    this.#renderMount(mount);
    this.#activeMounts.add(mount);
    return {
      update: (state: TCanvasPortalRenderState) => {
        const contentSignature = JSON.stringify(state.content);
        mount.state = state;
        if (contentSignature === mount.contentSignature) {
          mount.syncInteraction();
          return;
        }
        mount.contentSignature = contentSignature;
        this.#renderMount(mount);
      },
      dispose: () => {
        this.#activeMounts.delete(mount);
        mount.cleanup();
        mount.actionHandlers.clear();
        if (
          this.#props.crdtService.doc().elements[mount.elementId] === undefined
        ) {
          this.#titleActionStates.delete(mount.elementId);
        }
      },
    };
  }

  #renderMount(mount: TActiveMount): void {
    mount.cleanup();
    mount.actionHandlers.clear();
    const config = this.#configFor(mount.state.element);
    mount.cleanup = txMountWidgetPortal(
      { document: this.#props.browser.document },
      {
        host: mount.host,
        element: mount.state.element,
        config,
        error: this.getWidgetError(mount.state.element),
        titleBar: this.#titleBarFor(
          mount.state.element,
          config,
          mount.actionHandlers,
        ),
        resizeBoundary: mount.resizeBoundary,
        onContentPointerDown: () => {
          this.#focusWidgetContent(mount.elementId);
        },
      },
    );
    mount.syncInteraction();
  }

  #configFor(element: TElement): IWidgetConfig | null {
    if (element.data.type === "ui-widget") {
      return this.#registeredWidgetConfigs.get(element.data.kind) ?? null;
    }
    if (element.data.type !== "widget-instance" || !this.#props.neutralHost) {
      return null;
    }
    return {
      id: "__widget-instance-runtime",
      getTitle: (candidate) => candidate.data.type === "widget-instance"
        ? candidate.data.definitionId
        : "Widget",
      renderDom: ({ root, element: candidate }) => {
        return txMountCommittedWidgetRuntime({
          canvasId: this.#props.neutralHost!.canvasId,
          crdtService: this.#props.crdtService,
          runtime: this.#props.neutralHost!.runtime,
        }, {
          elementId: candidate.id,
          root,
        });
      },
    };
  }

  #titleFor(element: TElement, config: IWidgetConfig | null): string {
    const configured = config?.getTitle?.(element) ?? config?.tool?.label;
    if (configured !== undefined) {
      return configured;
    }
    if (element.data.type === "ui-widget") {
      return element.data.kind;
    }
    if (element.data.type === "widget-instance") {
      return `Widget ${element.data.definitionId.slice(0, 8)}`;
    }
    return "Widget";
  }

  #isContentFocused(elementId: string): boolean {
    if (this.#props.selectionService.focusedId !== elementId) {
      return false;
    }
    return !(
      this.#props.selectionService.selection?.some((target) => {
        return target.kind === "element" && target.id === elementId;
      }) ?? false
    );
  }

  #titleBarFor(
    element: TElement,
    config: IWidgetConfig | null,
    handlers: Map<string, () => void>,
  ): TWidgetTitleBarPortal | undefined {
    if (
      element.data.type !== "ui-widget"
      || config?.titleBarActions === undefined
      || config.titleBarActions.length === 0
    ) {
      return undefined;
    }
    const actionIds = new Set(config.titleBarActions.map((action) => action.id));
    const states = this.#titleActionStates.get(element.id)
      ?? new Map<string, TWidgetTitleBarActionState>();
    this.#titleActionStates.set(element.id, states);
    return {
      onAction(id, handler) {
        if (!actionIds.has(id)) {
          return () => undefined;
        }
        handlers.set(id, handler);
        return () => {
          if (handlers.get(id) === handler) {
            handlers.delete(id);
          }
        };
      },
      setActionState: (id, state) => {
        if (!actionIds.has(id)) {
          return;
        }
        const previous = states.get(id) ?? {};
        const next = { ...previous, ...state };
        if (
          previous.pressed === next.pressed
          && previous.disabled === next.disabled
          && previous.label === next.label
        ) {
          return;
        }
        states.set(id, next);
        this.#props.elementService.invalidateProjection();
      },
    };
  }

  #focusWidgetContent(elementId: string): boolean {
    const element = this.#props.crdtService.doc().elements[elementId];
    if (element === undefined || !fnIsWidgetElement(element)) {
      return false;
    }
    const target = { kind: "element", id: elementId } as const;
    const selectionChanged = this.#props.selectionService.setSelection([]);
    const focusChanged = this.#props.selectionService.setFocusedTarget(target, {
      allowUnselected: true,
    });
    return selectionChanged || focusChanged;
  }

  #invokeTitleAction(element: TElement, actionId: string): boolean {
    const config = this.#configFor(element);
    const action = config?.titleBarActions?.find((candidate) => {
      return candidate.id === actionId;
    });
    if (action === undefined) {
      return false;
    }
    if (
      this.#titleActionStates.get(element.id)?.get(actionId)?.disabled
      !== true
    ) {
      for (const mount of this.#activeMounts) {
        if (mount.elementId === element.id) {
          mount.actionHandlers.get(actionId)?.();
          break;
        }
      }
    }
    return true;
  }

  #refreshMounts(elementIds?: ReadonlySet<string>): void {
    for (const mount of this.#activeMounts) {
      if (elementIds === undefined || elementIds.has(mount.elementId)) {
        this.#renderMount(mount);
      }
    }
  }

  #getWidgetElementIds(kind?: string): string[] {
    return Object.values(this.#props.crdtService.doc().elements).flatMap((element) => {
      if (element.data.type !== "ui-widget" && element.data.type !== "widget-instance") {
        return [];
      }
      if (
        kind !== undefined
        && (element.data.type !== "ui-widget" || element.data.kind !== kind)
      ) {
        return [];
      }
      return [element.id];
    });
  }

  getWidgetError(element: TElement): TWidgetError | null {
    if (element.data.type === "widget-instance") {
      return this.#props.neutralHost
        ? null
        : {
            phase: "instance-start",
            code: "WIDGET_RUNTIME_UNAVAILABLE",
            message: "The widget runtime is unavailable.",
            retryable: true,
          };
    }
    if (element.data.type !== "ui-widget") {
      return null;
    }
    const error = this.#elementErrors.get(element.id)
      ?? this.#definitionErrors.get(element.data.kind)
      ?? this.#globalDefinitionError;
    if (error !== null && error !== undefined) {
      return error;
    }
    if (
      !this.#definitionDiscoveryComplete
      || this.#registeredWidgetConfigs.has(element.data.kind)
    ) {
      return null;
    }
    return {
      phase: "definition-fetch",
      code: "WIDGET_DEFINITION_UNAVAILABLE",
      message: `Widget definition "${element.data.kind}" is unavailable.`,
      retryable: true,
    };
  }

  completeDefinitionDiscovery(): void {
    if (this.#definitionDiscoveryComplete) {
      return;
    }
    this.#definitionDiscoveryComplete = true;
    this.#refreshMounts();
  }

  setGlobalDefinitionError(error: TWidgetError | null): void {
    if (fnWidgetErrorsEqual(this.#globalDefinitionError, error)) {
      return;
    }
    this.#globalDefinitionError = error;
    this.#refreshMounts();
  }

  setDefinitionError(kind: string, error: TWidgetError): void {
    this.#definitionErrors.set(kind, error);
    this.#refreshMounts(new Set(this.#getWidgetElementIds(kind)));
  }

  clearDefinitionError(kind: string): void {
    if (this.#definitionErrors.delete(kind)) {
      this.#refreshMounts(new Set(this.#getWidgetElementIds(kind)));
    }
  }

  setElementError(elementId: string, error: TWidgetError): void {
    this.#elementErrors.set(elementId, error);
    this.#refreshMounts(new Set([elementId]));
  }

  clearElementError(elementId: string): void {
    if (this.#elementErrors.delete(elementId)) {
      this.#refreshMounts(new Set([elementId]));
    }
  }

  registerWidget(config: IWidgetConfig): void {
    this.unregisterWidget(config.id);
    this.#registeredWidgetConfigs.set(config.id, config);
    this.#definitionErrors.delete(config.id);
    this.#cleanups.push(this.#props.elementService.registerElement({
      id: `ui-widget:${config.id}`,
      matchesElement: (element) => {
        return element.data.type === "ui-widget"
          && element.data.kind === config.id;
      },
      getTransformPolicy: ({ element }) => ({
        ...(fnIsWidgetElement(element)
            && element.data.window === WIDGET_WINDOW_FULLSCREEN
          ? { handles: [], allowRotate: false }
          : {}),
        allowFlip: false,
        keepAspectRatio: false,
        minSize: {
          width: WIDGET_HOST_MIN_WIDTH,
          height: WIDGET_HOST_MIN_HEIGHT,
        },
      }),
      prepareCloneData: ({ source, clone }) => {
        if (config.cloneable === false) {
          return null;
        }
        if (
          source.data.type !== "ui-widget"
          || clone.data.type !== "ui-widget"
          || config.createClonePayload === undefined
        ) {
          return;
        }
        return {
          ...clone.data,
          payload: config.createClonePayload(source.data.payload ?? {}),
        };
      },
    }));
    if (config.tool !== undefined) {
      const toolId = config.toolId ?? config.id;
      this.#registeredToolIdsByKind.set(config.id, toolId);
      this.#props.toolService.registerTool({
        id: toolId,
        label: config.tool.label,
        icon: config.tool.icon,
        shortcuts: config.tool.shortcuts,
        group: config.tool.group,
        priority: config.tool.priority,
        behavior: { type: "mode", mode: "draw-create" },
        widgetPlacement: config.widgetPlacement,
        createSession: (event) => {
              const product = this.#props.product();
              product.interactions.beginCreation(event, {
                thresholdViewport: 3,
                onCommit: (commit) => {
                  this.placeUiWidget({
                    kind: config.id,
                    bounds: fnWidgetCreationBounds({
                      commit,
                      defaultSize: { width: 480, height: 320 },
                      minSize: {
                        width: WIDGET_HOST_MIN_WIDTH,
                        height: WIDGET_HOST_MIN_HEIGHT,
                      },
                    }),
                    payload: config.createInitialPayload?.()
                      ?? config.initialPayload
                      ?? {},
                  });
                },
              });
              return {
                id: `widget-create:${toolId}:${event.pointerId}`,
                cancel: () => product.interactions.cancel(),
              };
            },
      });
    }
    this.#refreshMounts(new Set(this.#getWidgetElementIds(config.id)));
    this.hooks.widgetChange.call();
  }

  unregisterWidget(kind: string): void {
    const elementIds = this.#getWidgetElementIds(kind);
    this.#registeredWidgetConfigs.delete(kind);
    this.#props.elementService.unregisterElement(`ui-widget:${kind}`);
    const toolId = this.#registeredToolIdsByKind.get(kind);
    if (toolId !== undefined) {
      this.#props.toolService.unregisterTool(toolId);
      this.#registeredToolIdsByKind.delete(kind);
    }
    for (const elementId of elementIds) {
      this.#titleActionStates.delete(elementId);
    }
    this.#refreshMounts(new Set(elementIds));
    this.hooks.widgetChange.call();
  }

  registerPlacementTool(args: {
    id: string;
    label: string;
    tone?: "draft";
    icon?: string;
    group?: string;
    priority?: number;
    placement: TWidgetDropRequest;
  }): void {
    this.#props.toolService.registerTool({
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

  unregisterPlacementTool(id: string): void {
    this.#props.toolService.unregisterTool(id);
  }

  placeUiWidget(args: Readonly<{
    kind: string;
    bounds: TWidgetWorldBounds;
    payload?: Record<string, unknown>;
  }>): TElement {
    const timestamp = this.#props.browser.now();
    return this.#placeWidgetElement(fnCreateWidgetElement({
      id: this.#props.browser.createId(),
      dataType: "ui-widget",
      kind: args.kind,
      payload: args.payload,
      x: args.bounds.x,
      y: args.bounds.y,
      width: args.bounds.width,
      height: args.bounds.height,
      now: timestamp,
    }));
  }

  placeWidgetInstance(args: Readonly<{
    definitionId: string;
    revisionId: string;
    bounds: TWidgetWorldBounds;
    instanceId?: string;
    stateDocumentId?: string;
  }>): TElement {
    const timestamp = this.#props.browser.now();
    return this.#placeWidgetElement(fnCreateWidgetElement({
      id: this.#props.browser.createId(),
      dataType: "widget-instance",
      definitionId: args.definitionId,
      revisionId: args.revisionId,
      instanceId: args.instanceId ?? this.#props.browser.createId(),
      ...(args.stateDocumentId === undefined
        ? {}
        : { stateDocumentId: args.stateDocumentId }),
      x: args.bounds.x,
      y: args.bounds.y,
      width: args.bounds.width,
      height: args.bounds.height,
      now: timestamp,
    }));
  }

  #placeWidgetElement(element: TElement): TElement {
    const zIndex = fnNextWidgetZIndex({
      zIndices: this.#props.renderOrderService
        .getOrderedSiblings(null)
        .map((item) => item.zIndex),
    });
    const persisted = { ...element, zIndex };
    const commit = this.#props.crdtService
      .build()
      .patchElement(persisted.id, persisted)
      .commit();
    const target = { kind: "element", id: persisted.id } as const;
    this.#props.toolService.setActiveTool("select");
    this.#props.selectionService.setSelection([target]);
    this.#props.selectionService.setFocusedTarget(null);
    this.#props.historyService?.record({
      label: "create-widget",
      undo: () => {
        commit.rollback();
        this.#props.selectionService.pruneDocument(this.#props.crdtService.doc());
      },
      redo: () => {
        this.#props.crdtService.applyOps({ ops: commit.redoOps });
        this.#props.selectionService.setSelection([target]);
        this.#props.selectionService.setFocusedTarget(null);
      },
    });
    return persisted;
  }

  #patchWidgetFrame(
    elementId: string,
    patch: Readonly<{
      expanded?: boolean;
      window?: "contained" | "fullscreen" | "minimized";
    }>,
  ): boolean {
    const element = this.#props.crdtService.doc().elements[elementId];
    if (element === undefined || !fnIsWidgetElement(element)) {
      return false;
    }
    const data = { ...element.data, ...patch };
    const commit = this.#props.crdtService
      .build()
      .patchElement(elementId, "data", data)
      .commit();
    this.#props.historyService?.record({
      label: "update-widget-frame",
      undo: commit.rollback,
      redo: () => this.#props.crdtService.applyOps({ ops: commit.redoOps }),
    });
    return true;
  }

  #removeWidget(elementId: string, recordHistory = true): boolean {
    const element = this.#props.crdtService.doc().elements[elementId];
    if (element === undefined || !fnIsWidgetElement(element)) {
      return false;
    }
    this.#props.contextMenuService.close();
    const commit = this.#props.elementService
      .deleteElement(element, this.#props.crdtService.build())
      .commit();
    this.#props.selectionService.pruneDocument(this.#props.crdtService.doc());
    if (recordHistory && this.#props.historyService !== undefined) {
      const target = { kind: "element", id: elementId } as const;
      this.#props.historyService.record({
        label: "remove-widget",
        undo: () => {
          commit.rollback();
          this.#props.selectionService.setSelection([target]);
          this.#props.selectionService.setFocusedTarget(null);
        },
        redo: () => {
          this.#props.crdtService.applyOps({ ops: commit.redoOps });
          this.#props.selectionService.pruneDocument(this.#props.crdtService.doc());
        },
      });
    }
    return true;
  }

  async deleteWidgetInstanceDefinition(definitionId: string): Promise<boolean> {
    const deleteDefinition = this.#props.neutralHost?.deleteDefinition;
    if (deleteDefinition === undefined) {
      return false;
    }
    this.#props.contextMenuService.close();
    const confirmed = await this.#props.confirmDialogService.confirm({
      title: "Delete widget",
      description: "Delete this published widget definition and all of its current canvas instances? This action cannot be undone.",
      confirmLabel: "Delete widget",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!confirmed || !await deleteDefinition({ definitionId })) {
      return false;
    }
    let builder = this.#props.crdtService.build();
    for (const element of Object.values(this.#props.crdtService.doc().elements)) {
      if (
        element.data.type === "widget-instance"
        && element.data.definitionId === definitionId
      ) {
        builder = this.#props.elementService.deleteElement(element, builder);
      }
    }
    builder.commit();
    this.#props.selectionService.pruneDocument(this.#props.crdtService.doc());
    return true;
  }

  #openWidgetMenu(elementId: string, anchor: { x: number; y: number }): void {
    const element = this.#props.crdtService.doc().elements[elementId];
    if (element === undefined || !fnIsWidgetElement(element)) {
      return;
    }
    const target = { kind: "element", id: elementId } as const;
    this.#props.selectionService.setSelection([target]);
    this.#props.selectionService.setFocusedTarget(null);
    const definitionId = element.data.type === "widget-instance"
      ? element.data.definitionId
      : null;
    const deleteActions = definitionId !== null
      && this.#props.neutralHost?.deleteDefinition !== undefined
      ? [{
          id: "widget-delete-definition",
          label: "Delete widget",
          priority: 40,
          onSelect: () => {
            void this.deleteWidgetInstanceDefinition(definitionId);
          },
        }]
      : [];
    this.#props.contextMenuService.openWithActionsAt({
      x: anchor.x,
      y: anchor.y,
      actions: [
        {
          id: "widget-toggle-expanded",
          label: element.data.expanded === false
              || element.data.window === WIDGET_WINDOW_MINIMIZED
            ? "Restore"
            : "Minimize",
          priority: 10,
          onSelect: () => {
            this.#props.contextMenuService.close();
            const restore = element.data.expanded === false
              || element.data.window === WIDGET_WINDOW_MINIMIZED;
            this.#patchWidgetFrame(elementId, {
              expanded: restore,
              window: restore
                ? WIDGET_WINDOW_CONTAINED
                : WIDGET_WINDOW_MINIMIZED,
            });
          },
        },
        {
          id: "widget-toggle-fullscreen",
          label: element.data.window === WIDGET_WINDOW_FULLSCREEN
            ? "Exit fullscreen"
            : "Fullscreen",
          priority: 20,
          onSelect: () => {
            this.#props.contextMenuService.close();
            this.#patchWidgetFrame(elementId, {
              expanded: true,
              window: element.data.window === WIDGET_WINDOW_FULLSCREEN
                ? WIDGET_WINDOW_CONTAINED
                : WIDGET_WINDOW_FULLSCREEN,
            });
          },
        },
        {
          id: "widget-delete-instance",
          label: "Delete instance",
          priority: 30,
          onSelect: () => {
            this.#removeWidget(elementId);
          },
        },
        ...deleteActions,
      ],
    });
  }

  #handleSemanticWidgetClick(event: TElementPointerEvent): boolean {
    if (event.button !== 0) {
      return false;
    }
    const hit = event.hit;
    if (hit.target.kind !== "element") {
      return false;
    }
    const element = this.#props.crdtService.doc().elements[hit.target.id];
    if (element === undefined || !fnIsWidgetElement(element)) {
      return false;
    }
    const customPart = typeof hit.part === "object" ? hit.part.value : null;
    const isFrameControl = hit.part === "widget-minimize"
      || hit.part === "widget-restore"
      || hit.part === "widget-fullscreen"
      || customPart?.startsWith("control:") === true;
    if (!isFrameControl) {
      return false;
    }
    const target = { kind: "element", id: element.id } as const;
    this.#props.selectionService.setSelection([target]);
    this.#props.selectionService.setFocusedTarget(null);
    if (
      hit.part === "widget-minimize"
      || hit.part === "widget-restore"
      || customPart === "control:minimize"
      || customPart === "control:restore"
    ) {
      const restore = hit.part === "widget-restore"
        || customPart === "control:restore"
        || element.data.expanded === false
        || element.data.window === WIDGET_WINDOW_MINIMIZED;
      return this.#patchWidgetFrame(element.id, {
        expanded: restore,
        window: restore
          ? WIDGET_WINDOW_CONTAINED
          : WIDGET_WINDOW_MINIMIZED,
      });
    }
    if (
      hit.part === "widget-fullscreen"
      || customPart === "control:maximize"
      || customPart === "control:fullscreen"
    ) {
      return this.#patchWidgetFrame(element.id, {
        expanded: true,
        window: element.data.window === WIDGET_WINDOW_FULLSCREEN
          ? WIDGET_WINDOW_CONTAINED
          : WIDGET_WINDOW_FULLSCREEN,
      });
    }
    if (customPart === "control:close") {
      return this.#removeWidget(element.id);
    }
    if (customPart === "control:menu") {
      this.#openWidgetMenu(element.id, event.client);
      return true;
    }
    const actionId = customPart?.startsWith("control:")
      ? customPart.slice("control:".length)
      : null;
    return actionId === null
      ? false
      : this.#invokeTitleAction(element, actionId);
  }
}
