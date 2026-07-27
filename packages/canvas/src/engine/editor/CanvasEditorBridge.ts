import type {
  TConnectorNode,
  TInputEvent,
  TSceneChangeSet,
} from "@omnidraw/cangine";
import type {
  ICanvasEditor,
  ICanvasContextMenuController,
  ICanvasMenuController,
  IPathInteractionController,
  IWidgetInteractionController,
  TWidgetActivation,
  TWidgetInteractionState,
  TEditorTool,
  TCanvasContextMenuInvocation,
} from "@omnidraw/cangine/editor";
import type {
  TCanvasDoc,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { TCanvasTarget } from "../../semantic/typed";
import type { TCanvasProjectionIndex } from "../typed";
import type { CanvasEngineAdapter } from "../CanvasEngineAdapter";
import {
  CanvasEditorHistoryAdapter,
  type TCanvasEditorHistoryPort,
} from "./CanvasEditorHistoryAdapter";
import {
  fnCanvasPathReconciliationNode,
  type TCanvasPathCommitSource,
} from "./fn.path-commit";

export type TCanvasEditorSelectionSnapshot = Readonly<{
  selection: readonly TCanvasTarget[];
  focused: TCanvasTarget | null;
}>;

export type TCanvasEditorSelectionPort = {
  snapshot(): TCanvasEditorSelectionSnapshot;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  setSelection(selection: readonly TCanvasTarget[]): void;
  setFocusedTarget(
    target: TCanvasTarget | null,
    options?: Readonly<{ allowUnselected?: boolean }>,
  ): void;
  pathInteractionsEnabled?(): boolean;
};

export type TCanvasPathCommit = Readonly<{
  target: Extract<TCanvasTarget, { kind: "element" }>;
  node: Readonly<TConnectorNode>;
  source: TCanvasPathCommitSource;
  activeAnchorId: string | null;
}>;

export type TCanvasWidgetActivation =
  | Readonly<{
      type: "close" | "minimize";
      elementId: string;
    }>
  | Readonly<{
      type: "maximize";
      elementId: string;
      maximized: boolean;
    }>
  | Readonly<{
      type: "header-button";
      elementId: string;
      itemId: string;
    }>
  | Readonly<{
      type: "dropdown-item";
      elementId: string;
      itemId: string;
      dropdownItemId: string;
    }>;

export type TCanvasWidgetPresentationMode =
  | "inactive"
  | "frame"
  | "content"
  | "maximized";

export type TCanvasEditorContextMenuItem = Readonly<{
  id: string;
  text: string;
  disabled?: boolean;
  destructive?: boolean;
  shortcut?: string;
  separatorBefore?: boolean;
  activate(): void | Promise<void>;
}>;

export type TCanvasEditorContextMenuContext = Readonly<{
  invocation: TCanvasContextMenuInvocation;
  anchor: Readonly<{ x: number; y: number }>;
  target: TCanvasTarget | null;
}>;

export type TCanvasEditorContextMenuProvider = (
  context: TCanvasEditorContextMenuContext,
) => readonly TCanvasEditorContextMenuItem[];

export type TCanvasEditorBridgeArgs = {
  adapter: CanvasEngineAdapter;
  host: HTMLElement;
  history: TCanvasEditorHistoryPort;
  selection: TCanvasEditorSelectionPort;
  getDocument(): TCanvasDoc;
  getProjectionIndex(): TCanvasProjectionIndex | null;
  resolveNavigationIntent(event: TInputEvent): boolean;
  onPathCommit?(commit: TCanvasPathCommit): void;
  onError?(error: unknown): void;
};

const SELECT_TOOL_ID = "select";
const CONTEXT_MENU_COMMAND_ID = "vibecanvas.context-menu.activate";
const PATH_COMMIT_SOURCES = new Set<TCanvasPathCommitSource>([
  "cangine-editor:path-geometry",
  "cangine-editor:path-segment-mode",
  "cangine-editor:path-transform",
]);
const PATH_TRANSFORM_RECONCILE_SOURCE =
  "vibecanvas:path-transform-reconcile";

function historyShortcutTool(
  onError: ((error: unknown) => void) | undefined,
): TEditorTool {
  return {
    id: SELECT_TOOL_ID,
    handleInput: (event, context) => {
      if (event.type !== "key-down" || event.composing) {
        return undefined;
      }
      const modifier = event.modifiers.meta || event.modifiers.ctrl;
      const key = event.key.toLowerCase();
      const commandId = modifier && key === "z"
        ? event.modifiers.shift
          ? "editor.history.redo"
          : "editor.history.undo"
        : modifier && key === "y"
        ? "editor.history.redo"
        : null;
      if (commandId === null) {
        return undefined;
      }
      void context.editor.executeCommand(commandId).catch((error) => {
        onError?.(error);
      });
      return {
        handled: true,
        preventDefault: true,
        stopPropagation: true,
      };
    },
  };
}

function createExternalOverlayEditor(
  editor: ICanvasEditor,
  refreshSelection: () => void,
): ICanvasEditor {
  return new Proxy(editor, {
    get(target, property) {
      if (property === "refreshSelectionOverlay") {
        return refreshSelection;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Keeps Cangine's replaceable editor/controller state synchronized with
 * Vibecanvas semantic selection and CRDT history without exposing the raw
 * engine or allowing editor scene mutations to become durable authority.
 */
export class CanvasEditorBridge {
  readonly editor: ICanvasEditor;
  readonly menu: ICanvasMenuController;
  readonly paths: IPathInteractionController;
  readonly widgets: IWidgetInteractionController;
  readonly contextMenu: ICanvasContextMenuController;
  readonly #adapter: CanvasEngineAdapter;
  readonly #history: CanvasEditorHistoryAdapter;
  readonly #selection: TCanvasEditorSelectionPort;
  readonly #getDocument: () => TCanvasDoc;
  readonly #getProjectionIndex: () => TCanvasProjectionIndex | null;
  readonly #onPathCommit: ((commit: TCanvasPathCommit) => void) | undefined;
  readonly #onError: ((error: unknown) => void) | undefined;
  readonly #activationListeners = new Set<
    (activation: TCanvasWidgetActivation) => void
  >();
  readonly #presentationListeners = new Set<() => void>();
  readonly #contextMenuActions = new Map<
    string,
    TCanvasEditorContextMenuItem
  >();
  #contextMenuProvider: TCanvasEditorContextMenuProvider | null = null;
  #cleanups: Array<() => void> = [];
  #syncing = false;
  #attached = false;
  #destroyed = false;

  constructor(args: TCanvasEditorBridgeArgs) {
    this.#adapter = args.adapter;
    this.#selection = args.selection;
    this.#getDocument = args.getDocument;
    this.#getProjectionIndex = args.getProjectionIndex;
    this.#onPathCommit = args.onPathCommit;
    this.#onError = args.onError;
    this.#history = new CanvasEditorHistoryAdapter(args.history);
    this.editor = args.adapter.createEditor({
      selectionOverlay: false,
      tools: [historyShortcutTool(args.onError)],
      commands: [{
        id: CONTEXT_MENU_COMMAND_ID,
        isEnabled: (_context, token) => {
          if (typeof token !== "string") {
            return false;
          }
          const action = this.#contextMenuActions.get(token);
          return action !== undefined && action.disabled !== true;
        },
        execute: async (_context, token) => {
          if (typeof token !== "string") {
            return;
          }
          await this.#contextMenuActions.get(token)?.activate();
        },
      }],
      initialToolId: SELECT_TOOL_ID,
      history: {
        kind: "custom",
        adapter: this.#history,
      },
      ...(args.onError === undefined
        ? {}
        : { onCallbackError: args.onError }),
    });
    this.menu = args.adapter.createMenuController({
      overlayHost: args.host,
      accessibilityLabel: "Canvas actions",
      ...(args.onError === undefined
        ? {}
        : { onCallbackError: args.onError }),
    });
    const widgetEditor = createExternalOverlayEditor(
      this.editor,
      () => this.#selection.refresh(),
    );
    this.widgets = args.adapter.createWidgetInteractionController({
      editor: widgetEditor,
      menu: this.menu,
      focusRoot: args.host,
      focusClusterRoot: args.host,
      resolveNavigationIntent: args.resolveNavigationIntent,
      onActivation: (activation) => this.#onActivation(activation),
      ...(args.onError === undefined
        ? {}
        : { onCallbackError: args.onError }),
    });
    this.contextMenu = args.adapter.createContextMenuController({
      editor: this.editor,
      menu: this.menu,
      eventTarget: args.host,
      resolveNodeId: (hit) => {
        const target = this.#targetForRawHit(hit);
        return target === null ? null : this.#nodeForTarget(target);
      },
      items: (context) => {
        this.#contextMenuActions.clear();
        const items = this.#contextMenuProvider?.({
          invocation: context.invocation,
          anchor: { ...context.anchor },
          target: context.hit === null && context.invocation === "keyboard"
            ? this.#selection.snapshot().focused
              ?? this.#selection.snapshot().selection.at(-1)
              ?? null
            : context.hit === null
            ? null
            : this.#targetForRawHit(context.hit),
        }) ?? [];
        return items.map((item, index) => {
          const token = `${index}:${item.id}`;
          this.#contextMenuActions.set(token, item);
          return {
            id: item.id,
            text: item.text,
            commandId: CONTEXT_MENU_COMMAND_ID,
            args: token,
            ...(item.disabled === undefined
              ? {}
              : { disabled: item.disabled }),
            ...(item.destructive === undefined
              ? {}
              : { destructive: item.destructive }),
            ...(item.shortcut === undefined
              ? {}
              : { shortcut: item.shortcut }),
            ...(item.separatorBefore === undefined
              ? {}
              : { separatorBefore: item.separatorBefore }),
          };
        });
      },
      ...(args.onError === undefined
        ? {}
        : { onCallbackError: args.onError }),
    });
    this.paths = args.adapter.createPathInteractionController({
      editor: this.editor,
      ownerId: "vibecanvas:path-interaction",
      ...(args.onError === undefined
        ? {}
        : { onCallbackError: args.onError }),
    });
  }

  attach(): void {
    this.#assertActive();
    if (this.#attached) {
      return;
    }
    this.widgets.attach();
    this.contextMenu.attach();
    this.paths.attach();
    this.editor.attach();
    this.#cleanups = [
      this.#selection.subscribe(() => this.syncSelection()),
      this.widgets.subscribe((state) => this.#syncProductFromWidgets(state)),
      this.paths.subscribe(() => this.#notifyPresentationListeners()),
      this.editor.subscribe(() => this.#selection.refresh()),
      this.#adapter.subscribeScene((change) => this.#onSceneChange(change)),
    ];
    this.#attached = true;
    this.syncSelection();
  }

  syncSelection(): void {
    if (!this.#attached || this.#destroyed || this.#syncing) {
      return;
    }
    const product = this.#selection.snapshot();
    this.editor.setActiveTool(
      this.#selection.pathInteractionsEnabled?.() === false
        ? null
        : SELECT_TOOL_ID,
    );
    const contentNodeId = this.widgets.state.contentNodeId;
    if (
      contentNodeId !== null
      && product.selection.length === 0
      && this.#targetForNode(contentNodeId)?.id === product.focused?.id
    ) {
      return;
    }
    const nodeIds = product.selection.flatMap((target) => {
      const nodeId = this.#nodeForTarget(target);
      return nodeId === null ? [] : [nodeId];
    });
    const focusedNodeId = product.focused === null
      ? null
      : this.#nodeForTarget(product.focused);
    this.#syncing = true;
    try {
      this.editor.setSelection(nodeIds, { focusedNodeId });
    } finally {
      this.#syncing = false;
    }
  }

  subscribeWidgetActivation(
    listener: (activation: TCanvasWidgetActivation) => void,
  ): () => void {
    this.#assertActive();
    this.#activationListeners.add(listener);
    return () => {
      this.#activationListeners.delete(listener);
    };
  }

  subscribeWidgetPresentation(listener: () => void): () => void {
    this.#assertActive();
    this.#presentationListeners.add(listener);
    return () => {
      this.#presentationListeners.delete(listener);
    };
  }

  registerContextMenuProvider(
    provider: TCanvasEditorContextMenuProvider,
  ): () => void {
    this.#assertActive();
    this.#contextMenuProvider = provider;
    return () => {
      if (this.#contextMenuProvider === provider) {
        this.#contextMenuProvider = null;
        this.#contextMenuActions.clear();
        this.menu.close();
      }
    };
  }

  widgetMode(elementId: string): TCanvasWidgetPresentationMode {
    const nodeId = this.#widgetNodeForElement(elementId);
    if (nodeId === null) {
      return "inactive";
    }
    if (this.widgets.state.maximizedNodeId === nodeId) {
      return "maximized";
    }
    return this.widgets.modeFor(nodeId);
  }

  focusWidgetContent(elementId: string): boolean {
    this.#assertActive();
    const nodeId = this.#widgetNodeForElement(elementId);
    return nodeId === null ? false : this.widgets.enterContentMode(nodeId);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    for (const cleanup of this.#cleanups.splice(0).reverse()) {
      cleanup();
    }
    this.paths.destroy();
    this.contextMenu.destroy();
    this.widgets.destroy();
    this.menu.destroy();
    this.editor.destroy();
    this.#history.destroy();
    this.#activationListeners.clear();
    this.#presentationListeners.clear();
    this.#contextMenuProvider = null;
    this.#contextMenuActions.clear();
    this.#attached = false;
  }

  #onSceneChange(
    change: Pick<TSceneChangeSet, "source" | "updated">,
  ): void {
    if (
      this.#onPathCommit === undefined
      || !PATH_COMMIT_SOURCES.has(change.source as TCanvasPathCommitSource)
    ) {
      return;
    }
    const source = change.source as TCanvasPathCommitSource;
    for (const nodeId of change.updated) {
      const target = this.#targetForNode(nodeId);
      const node = this.#adapter.sceneNode(nodeId);
      if (target?.kind !== "element" || node?.kind !== "connector") {
        continue;
      }
      try {
        const reconciliationNode = fnCanvasPathReconciliationNode({
          node,
          source,
        });
        if (reconciliationNode !== null) {
          void this.#adapter.applyCommands({
            source: PATH_TRANSFORM_RECONCILE_SOURCE,
            render: "none",
            commands: [{
              type: "upsert",
              node: reconciliationNode,
            }],
          }).then((result) => {
            if (!result.ok) {
              this.#onError?.(result.error);
            }
          }).catch((error) => {
            this.#onError?.(error);
          });
        }
        this.#onPathCommit({
          target,
          node,
          source,
          activeAnchorId: this.paths.state.activeAnchorId,
        });
      } catch (error) {
        this.#onError?.(error);
      }
    }
  }

  #notifyPresentationListeners(): void {
    for (const listener of [...this.#presentationListeners]) {
      listener();
    }
  }

  #syncProductFromWidgets(state: TWidgetInteractionState): void {
    if (!this.#attached || this.#destroyed || this.#syncing) {
      return;
    }
    this.#syncing = true;
    try {
      if (state.contentNodeId !== null) {
        const target = this.#targetForNode(state.contentNodeId);
        if (target !== null) {
          this.#selection.setSelection([]);
          this.#selection.setFocusedTarget(target, { allowUnselected: true });
        }
      } else if (state.frameNodeId !== null) {
        const target = this.#targetForNode(state.frameNodeId);
        if (target !== null) {
          this.#selection.setSelection([target]);
          this.#selection.setFocusedTarget(null);
        }
      }
    } finally {
      this.#syncing = false;
    }
    this.#notifyPresentationListeners();
  }

  #onActivation(activation: TWidgetActivation): void {
    const target = this.#targetForNode(activation.widgetId);
    if (
      target?.kind !== "element"
      || this.#widgetNodeForElement(target.id) !== activation.widgetId
    ) {
      return;
    }
    const mapped: TCanvasWidgetActivation = activation.type === "traffic-light"
      ? {
          type: activation.control,
          elementId: target.id,
        }
      : activation.type === "maximize"
      ? {
          type: "maximize",
          elementId: target.id,
          maximized: activation.maximized,
        }
      : activation.type === "header-button"
      ? {
          type: "header-button",
          elementId: target.id,
          itemId: activation.itemId,
        }
      : {
          type: "dropdown-item",
          elementId: target.id,
          itemId: activation.itemId,
          dropdownItemId: activation.dropdownItemId,
        };
    for (const listener of [...this.#activationListeners]) {
      listener(mapped);
    }
  }

  #nodeForTarget(target: TCanvasTarget): string | null {
    const index = this.#getProjectionIndex();
    if (index === null) {
      return null;
    }
    if (target.kind === "group") {
      return index.groupNodeIds[target.id] ?? null;
    }
    const nodeIds = index.elementNodeIds[target.id] ?? [];
    return nodeIds.find((nodeId) => {
      return this.#targetForNode(nodeId)?.kind === "element"
        && nodeId.endsWith(":render");
    }) ?? nodeIds[0] ?? null;
  }

  #widgetNodeForElement(elementId: string): string | null {
    const data = this.#getDocument().elements[elementId]?.data;
    if (data?.type !== "ui-widget" && data?.type !== "widget-instance") {
      return null;
    }
    const index = this.#getProjectionIndex();
    const nodeIds = index?.elementNodeIds[elementId] ?? [];
    return nodeIds.find((nodeId) => nodeId.endsWith(":render")) ?? null;
  }

  #targetForNode(nodeId: string): TCanvasTarget | null {
    return this.#getProjectionIndex()?.nodeTargets[nodeId] ?? null;
  }

  #targetForRawHit(hit: Readonly<{
    nodeId: string;
    path: readonly string[];
  }>): TCanvasTarget | null {
    for (let index = hit.path.length - 1; index >= 0; index -= 1) {
      const target = this.#targetForNode(hit.path[index]!);
      if (target !== null) {
        return target;
      }
    }
    return this.#targetForNode(hit.nodeId);
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("Canvas editor bridge is destroyed.");
    }
  }
}
