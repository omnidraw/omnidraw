import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import ArrowRight from "lucide-static/icons/arrow-right.svg?raw";
import Konva from "konva";
import Minus from "lucide-static/icons/minus.svg?raw";
import { throttle } from "@solid-primitives/scheduled";
import { resolveThemeColor, type ThemeService } from "@vibecanvas/service-theme";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import type { IRuntimeHooks } from "../../types";
import type { CameraService } from "../../services/camera/CameraService";
import type { CanvasRegistryService } from "../../services/canvas-registry/CanvasRegistryService";
import type { ContextMenuService } from "../../services/context-menu/ContextMenuService";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { EditorService } from "../../services/editor/EditorService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { SelectionService } from "../../services/selection/SelectionService";
import { txDeleteSelection } from "../select/tx.delete-selection";
import { type THandleDragSnapshot, type TPoint, type TShape1dNode } from "./CONSTANTS";
import { fxApplyAnchorDrag, fxGetInsertionPoint, fxLocalPointToWorld } from "./fx.geometry";
import {
  fxFindShape1dNodeById,
  fxGetElementData,
  fxHasRenderableRuntime,
  fxIsShape1dNode,
  fxIsSupportedElementType,
  fxIsSupportedTool,
  fxToTElement,
} from "./fx.node";
import {
  txCancelShape1dDraft,
  txFinalizeShape1dDraft,
  txResetShape1dDraft,
  txResetShape1dPreview,
  txStartShape1dDraft,
  txUpdateShape1dDraftCurrentPoint,
} from "./tx.draft";
import {
  txClearShape1dEditHandles,
  txEnterShape1dEditMode,
  txExitShape1dEditMode,
  txRefreshShape1dEditMode,
} from "./tx.edit-mode";
import { txCreatePreviewClone, txUpdateShapeFromElement } from "./tx.element";
import { type TPortalTxRecordShape1dHistory } from "./tx.history";
import { txRegisterShape1dElement } from "./tx.register-shape1d-element";
import { txRegisterShape1dTool } from "./tx.register-shape1d-tool";
import { txAttachShapeRuntime, txCreateShapeFromElement } from "./tx.render";
import {
  txEnsureShape1dMove,
  txFinalizeShape1dMove,
  txPatchShape1dMove,
} from "./tx.shape-move";
import { txCreateCloneDrag, txSetupShapeListeners } from "./tx.runtime";
import type { TShape1dPluginState } from "./typed";

const TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR = "vcTransformMoveBeforeElement";
const TRANSFORM_BEFORE_ELEMENT_ATTR = "vcTransformBeforeElement";
const MOVE_PATCH_INTERVAL_MS = 100;

const setNodeZIndex = (node: Konva.Group | Konva.Shape, zIndex: string) => txSetNodeZIndex({}, { node, zIndex });

function createCreateId(render: SceneService) {
  let fallbackId = 0;

  return () => {
    const cryptoApi = render.container.ownerDocument.defaultView?.crypto;
    if (cryptoApi?.randomUUID) {
      return cryptoApi.randomUUID();
    }

    fallbackId += 1;
    return `shape1d-${Date.now()}-${fallbackId}`;
  };
}

/**
 * Owns line/arrow registration, create flow, edit handles, clone-drag,
 * transform ownership, and CanvasRegistry integration for 1d shapes.
 */
export function createShape1dPlugin(): IPlugin<{
  camera: CameraService;
  canvasRegistry: CanvasRegistryService;
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  editor: EditorService;
  history: HistoryService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: ThemeService;
}, IRuntimeHooks> {
  const state: TShape1dPluginState = {
    previewShape: null,
    draftElementId: null,
    draftStartPoint: null,
    draftCurrentPoint: null,
    anchorHandles: [],
    insertHandles: [],
    activeHandleDrag: null,
    previousToolId: "select",
    moveSessions: new Map(),
  };

  return {
    name: "shape1d",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const canvasRegistry = ctx.services.require("canvasRegistry");
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const editor = ctx.services.require("editor");
      const history = ctx.services.require("history");
      const render = ctx.services.require("scene");
      const renderOrder = ctx.services.require("renderOrder");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      state.previousToolId = editor.activeToolId;
      const createId = createCreateId(render);
      const now = () => Date.now();

      const createShapeNode = (config?: Record<string, unknown>) => {
        return new Konva.Shape({
          perfectDrawEnabled: false,
          lineCap: "round",
          lineJoin: "round",
          ...config,
        }) as TShape1dNode;
      };
      const findNode = (id: string): TShape1dNode | null => fxFindShape1dNodeById({ Shape: Konva.Shape, render }, { id }) ?? null;
      const getData = (node: TShape1dNode) => fxGetElementData({}, { node });
      const isNode = (node: Konva.Node | null | undefined): node is TShape1dNode => fxIsShape1dNode( { node });
      const isTool = (tool: string): tool is "line" | "arrow" => fxIsSupportedTool({}, { tool });
      const isType = (type: string): boolean => fxIsSupportedElementType({}, { type });
      const toWorld = (node: TShape1dNode, point: TPoint | { x: number; y: number }) => fxLocalPointToWorld({}, { node, point });
      const insertionPoint = (data: Parameters<typeof fxGetInsertionPoint>[1]["data"], segmentIndex: number) => fxGetInsertionPoint({}, { data, segmentIndex });
      const applyAnchorDrag = (node: TShape1dNode, drag: THandleDragSnapshot, worldPoint: { x: number; y: number }) => fxApplyAnchorDrag({}, { node, drag, worldPoint });
      const createShape = (element: TElement) => txCreateShapeFromElement({ createShapeNode, setNodeZIndex, theme, resolveThemeColor }, { element });
      const updateShape = (node: TShape1dNode, element: TElement) => txUpdateShapeFromElement({ theme, resolveThemeColor, setNodeZIndex }, { node, element });
      const toElement = (node: TShape1dNode) => fxToTElement({ editor: canvasRegistry, now }, { node });
      const applyElement = (element: TElement) => {
        const didUpdate = canvasRegistry.updateElement(element);
        if (!didUpdate) {
          return;
        }

        render.staticForegroundLayer.batchDraw();
      };

      const historyPortal: TPortalTxRecordShape1dHistory = {
        Shape: Konva.Shape,
        canvasRegistry,
        crdt,
        history,
        render,
        renderOrder,
        selection,
        theme,
        resolveThemeColor,
        createShapeNode,
        setNodeZIndex,
        setupNode,
      };

      const runtimePortal = {
        ...historyPortal,
        Konva,
        hooks: ctx.hooks,
        createId,
        now,
        createThrottledPatch: (callback: (patch: Pick<TElement, "id" | "x" | "y" | "parentGroupId" | "updatedAt">) => void) => throttle(callback, MOVE_PATCH_INTERVAL_MS),
      };

      function currentTool() {
        return isTool(editor.activeToolId) ? editor.activeToolId : null;
      }

      function setupNode(node: TShape1dNode) {
        txAttachShapeRuntime({}, { node });
        txSetupShapeListeners(runtimePortal, { node });
        node.setDraggable(true);
        node.listening(true);
        node.visible(true);
        return node;
      }

      const draftPortal = {
        state,
        editor,
        render,
        renderOrder,
        selection,
        theme,
        createId,
        now,
        createShape,
        updateShape,
        setupNode,
        toElement,
        historyPortal,
      };

      const editModePortal = {
        state,
        Circle: Konva.Circle,
        canvasRegistry,
        editor,
        render,
        selection,
        historyPortal,
        findNode,
        getData,
        toWorld,
        insertionPoint,
        applyAnchorDrag,
        toElement,
      };

      const movePortal = {
        state,
        canvasRegistry,
        crdt,
        history,
        now,
        movePatchIntervalMs: MOVE_PATCH_INTERVAL_MS,
        transformMoveBeforeAttr: TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR,
        toElement,
        applyElement,
      };

      const shape1dRegistryPortal = {
        Shape: Konva.Shape,
        canvasRegistry,
        crdt,
        history,
        applyElement,
        createShape,
        findNode,
        getData,
        isNode,
        setupNode,
        toElement,
        txCreateCloneDrag: (node: TShape1dNode) => {
          txCreateCloneDrag(runtimePortal, { node });
        },
        txEnsureShapeMove: (node: TShape1dNode) => txEnsureShape1dMove(movePortal, { node }),
        txPatchShapeMove: (node: TShape1dNode) => txPatchShape1dMove(movePortal, { node }),
        txFinalizeShapeMove: (node: TShape1dNode) => txFinalizeShape1dMove(movePortal, { node }),
        updateShape,
      };

      const unregisterLineElement = txRegisterShape1dElement(shape1dRegistryPortal, {
        type: "line",
        beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
      });

      const unregisterArrowElement = txRegisterShape1dElement(shape1dRegistryPortal, {
        type: "arrow",
        beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
      });

      let unregisterArrowTool = () => {};
      let unregisterLineTool = () => {};

      contextMenu.registerProvider("shape1d", ({ targetElement, activeSelection }) => {
        if (!targetElement || !isType(targetElement.data.type)) {
          return [];
        }

        return [{
          id: "delete-shape1d-selection",
          label: "Delete",
          priority: 300,
          onSelect: () => {
            selection.setSelection(activeSelection);
            txDeleteSelection({ canvasRegistry, crdt, history, render, renderOrder, selection }, {});
          },
        }];
      });

      ctx.hooks.init.tap(() => {
        unregisterArrowTool = txRegisterShape1dTool({ editor }, {
          id: "arrow",
          label: "Arrow",
          icon: ArrowRight,
          shortcuts: ["5", "a"],
          priority: 50,
        });
        unregisterLineTool = txRegisterShape1dTool({ editor }, {
          id: "line",
          label: "Line",
          icon: Minus,
          shortcuts: ["6", "l"],
          priority: 60,
        });
      });

      ctx.hooks.pointerDown.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!currentTool()) {
          return;
        }

        const pointer = render.dynamicLayer.getRelativePointerPosition();
        if (!pointer) {
          return;
        }

        txStartShape1dDraft(draftPortal, {
          point: { x: pointer.x, y: pointer.y },
        });
      });

      ctx.hooks.pointerMove.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!currentTool() || !state.draftStartPoint) {
          return;
        }

        const pointer = render.dynamicLayer.getRelativePointerPosition();
        if (!pointer) {
          return;
        }

        txUpdateShape1dDraftCurrentPoint(draftPortal, {
          point: { x: pointer.x, y: pointer.y },
        });
      });

      ctx.hooks.pointerUp.tap(() => {
        txFinalizeShape1dDraft(draftPortal);
      });

      ctx.hooks.pointerCancel.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE || !currentTool()) {
          return;
        }

        txCancelShape1dDraft(draftPortal);
      });

      ctx.hooks.keydown.tap((event) => {
        if (event.key === "Escape"
          && selection.mode === CanvasMode.DRAW_CREATE
          && currentTool()
          && state.previewShape) {
          event.preventDefault();
          event.stopPropagation();
          txCancelShape1dDraft(draftPortal);
          return;
        }

        if (event.key === "Enter"
          && selection.mode === CanvasMode.SELECT
          && editor.editingShape1dId === null) {
          const filteredSelection = fnFilterSelection({
            selection: selection.selection,
          });
          const target = filteredSelection.length === 1 && isNode(filteredSelection[0])
            && selection.focusedId === filteredSelection[0].id()
              ? filteredSelection[0]
              : null;
          if (!target) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          txEnterShape1dEditMode(editModePortal, { node: target });
          return;
        }

        if (event.key !== "Escape" || editor.editingShape1dId === null) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        txExitShape1dEditMode(editModePortal);
      });

      ctx.hooks.elementPointerDoubleClick.tap((event) => {
        const filteredSelection = fnFilterSelection({
          selection: selection.selection,
        });
        if (!isNode(event.currentTarget) || filteredSelection.length !== 1 || filteredSelection[0] !== event.currentTarget) {
          return false;
        }

        txEnterShape1dEditMode(editModePortal, { node: event.currentTarget });
        return true;
      });

      ctx.hooks.pointerDown.tap((event) => {
        if (selection.mode === CanvasMode.SELECT && editor.editingShape1dId !== null && event.target === render.stage) {
          txExitShape1dEditMode(editModePortal);
        }
      });

      ctx.hooks.toolSelect.tap((toolId) => {
        if (isTool(toolId)) {
          return;
        }

        txResetShape1dDraft(draftPortal);
        txResetShape1dPreview(draftPortal);
      });

      editor.hooks.activeToolChange.tap((toolId) => {
        if (toolId !== state.previousToolId) {
          txResetShape1dDraft(draftPortal);
          txResetShape1dPreview(draftPortal);
        }
        state.previousToolId = toolId;
      });

      selection.hooks.change.tap(() => {
        txRefreshShape1dEditMode(editModePortal);
      });
      camera.hooks.change.tap(() => {
        txRefreshShape1dEditMode(editModePortal);
      });
      editor.hooks.editingShape1dChange.tap(() => {
        txRefreshShape1dEditMode(editModePortal);
      });
      theme.hooks.change.tap(() => {
        render.staticForegroundLayer.find((candidate: Konva.Node) => {
          return isNode(candidate);
        }).forEach((candidate) => {
          if (!isNode(candidate)) {
            return;
          }

          updateShape(candidate, toElement(candidate));
        });
        render.staticForegroundLayer.batchDraw();
        txRefreshShape1dEditMode(editModePortal);
      });

      ctx.hooks.destroy.tap(() => {
        txResetShape1dDraft(draftPortal);
        txResetShape1dPreview(draftPortal);
        txClearShape1dEditHandles(editModePortal);
        state.activeHandleDrag = null;
        state.moveSessions.clear();
        editor.setEditingShape1dId(null);
        contextMenu.unregisterProvider("shape1d");
        unregisterLineElement();
        unregisterArrowElement();
        unregisterArrowTool();
        unregisterLineTool();
      });
    },
  };
}

export const Shape1dPlugin = {
  fxIsSupportedTool,
  fxIsSupportedElementType,
  fxFindShape1dNodeById,
  fxGetElementData,
  fxIsShape1dNode,
  fxHasRenderableRuntime,
  txCreateShapeFromElement,
  txUpdateShapeFromElement,
  fxToTElement,
  txCreatePreviewClone,
  txCreateCloneDrag,
  txSetupShapeListeners,
};
