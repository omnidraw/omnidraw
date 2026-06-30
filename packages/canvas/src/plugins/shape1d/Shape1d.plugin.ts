import { throttle } from "@solid-primitives/scheduled";
import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { resolveThemeColor, type ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import ArrowRight from "lucide-static/icons/arrow-right.svg?raw";
import Minus from "lucide-static/icons/minus.svg?raw";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import type {
  SceneService,
  TToolCanvasPoint
} from "../../services";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import { txDeleteSelection } from "../select/tx.delete-selection";
import { type THandleDragSnapshot, type TPoint, type TShape1dNode } from "./CONSTANTS";
import { fnCreateDraftElement } from "./fn.draft";
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
  txClearShape1dEditHandles,
  txEnterShape1dEditMode,
  txExitShape1dEditMode,
  txRefreshShape1dEditMode,
} from "./tx.edit-mode";
import { txUpdateShapeFromElement } from "./tx.element";
import { type TPortalTxRecordShape1dHistory } from "./tx.history";
import { txRegisterShape1dElement } from "./tx.register-shape1d-element";
import { txAttachShapeRuntime, txCreateShapeFromElement } from "./tx.render";
import { txCreateCloneDrag, txSetupShapeListeners } from "./tx.runtime";
import {
  txEnsureShape1dMove,
  txFinalizeShape1dMove,
  txPatchShape1dMove,
} from "./tx.shape-move";
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

function fxCreateShape1dDraftNode(args: {
  createShapeNode: (config?: Record<string, unknown>) => TShape1dNode;
  point: TToolCanvasPoint;
}) {
  const node = args.createShapeNode({
    id: "shape1d-draft",
    x: args.point.x,
    y: args.point.y,
    visible: false,
    listening: false,
    draggable: false,
  });

  txAttachShapeRuntime({}, { node });
  return node;
}

function txUpdateShape1dDraftNode(args: {
  previewNode: Konva.Node;
  activeTool: "line" | "arrow";
  origin: TToolCanvasPoint;
  point: TToolCanvasPoint;
  now: () => number;
  rememberedStyle: ReturnType<ThemeService["getRememberedStyle"]>;
  updateShape: (node: TShape1dNode, element: TElement) => void;
}) {
  if (!(args.previewNode instanceof Konva.Shape)) {
    return;
  }

  const previewNode = args.previewNode as TShape1dNode;
  const element = fnCreateDraftElement({
    activeTool: args.activeTool,
    draftElementId: previewNode.id(),
    draftStartPoint: [args.origin.x, args.origin.y],
    draftCurrentPoint: [args.point.x, args.point.y],
    createId: () => previewNode.id(),
    now: args.now,
    rememberedStyle: args.rememberedStyle,
  });

  if (!element) {
    previewNode.setAttr(ELEMENT_DATA_ATTR, undefined);
    previewNode.visible(false);
    previewNode.listening(false);
    previewNode.draggable(false);
    previewNode.getLayer()?.batchDraw();
    return;
  }

  args.updateShape(previewNode, element);
  previewNode.visible(true);
  previewNode.listening(false);
  previewNode.draggable(false);
  previewNode.getLayer()?.batchDraw();
}

/**
 * Owns line/arrow registration, create flow, edit handles, clone-drag,
 * transform ownership, and element integration for 1d shapes.
 */
export function createShape1dPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
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
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const group = ctx.services.require("group");
      const history = ctx.services.require("history");
      const render = ctx.services.require("scene");
      const renderOrder = ctx.services.require("renderOrder");
      const selection = ctx.services.require("selection");
      const session = ctx.services.require("session");
      const theme = ctx.services.require("theme");
      const tool = ctx.services.require("tool");
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
      const isNode = (node: Konva.Node | null | undefined): node is TShape1dNode => fxIsShape1dNode({}, { node });
      const isTool = (toolId: string): toolId is "line" | "arrow" => fxIsSupportedTool({}, { tool: toolId });
      const isType = (type: string): boolean => fxIsSupportedElementType({}, { type });
      const toWorld = (node: TShape1dNode, point: TPoint | { x: number; y: number }) => fxLocalPointToWorld({}, { node, point });
      const insertionPoint = (data: Parameters<typeof fxGetInsertionPoint>[1]["data"], segmentIndex: number) => fxGetInsertionPoint({}, { data, segmentIndex });
      const applyAnchorDrag = (node: TShape1dNode, drag: THandleDragSnapshot, worldPoint: { x: number; y: number }) => fxApplyAnchorDrag({}, { node, drag, worldPoint });
      const createShape = (shapeElement: TElement) => txCreateShapeFromElement({ createShapeNode, setNodeZIndex, theme, resolveThemeColor }, { element: shapeElement });
      const updateShape = (node: TShape1dNode, shapeElement: TElement) => txUpdateShapeFromElement({ theme, resolveThemeColor, setNodeZIndex }, { node, element: shapeElement });
      const toElement = (node: TShape1dNode) => fxToTElement({ now }, { node });
      const applyElement = (shapeElement: TElement) => {
        const didUpdate = element.updateElement(shapeElement);
        if (!didUpdate) {
          return;
        }

        render.staticForegroundLayer.batchDraw();
      };

      const historyPortal: TPortalTxRecordShape1dHistory = {
        Shape: Konva.Shape,
        element,
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
        group,
        createThrottledPatch: (callback: (patch: Pick<TElement, "id" | "x" | "y" | "parentGroupId" | "updatedAt">) => void) => throttle(callback, MOVE_PATCH_INTERVAL_MS),
      };

      function currentTool() {
        return isTool(tool.activeToolId) ? tool.activeToolId : null;
      }

      function setupNode(node: TShape1dNode) {
        txAttachShapeRuntime({}, { node });
        txSetupShapeListeners(runtimePortal, { node });
        node.setDraggable(true);
        node.listening(true);
        node.visible(true);
        return node;
      }

      const editModePortal = {
        state,
        Circle: Konva.Circle,
        session,
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
        crdt,
        history,
        now,
        movePatchIntervalMs: MOVE_PATCH_INTERVAL_MS,
        transformMoveBeforeAttr: TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR,
        toElement,
        applyElement,
      };

      const shape1dElementPortal = {
        Shape: Konva.Shape,
        element,
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

      const unregisterLineElement = txRegisterShape1dElement(shape1dElementPortal, {
        type: "line",
        beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
      });

      const unregisterArrowElement = txRegisterShape1dElement(shape1dElementPortal, {
        type: "arrow",
        beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
      });

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
            txDeleteSelection({
              element,
              group,
              crdt,
              history,
              scene: render,
              renderOrder,
              selection,
            }, {});
          },
        }];
      });

      ctx.hooks.init.tap(() => {
        tool.registerTool({
          id: "arrow",
          label: "Arrow",
          icon: ArrowRight,
          shortcuts: ["5", "a"],
          priority: 50,
          behavior: { type: "mode", mode: "draw-create" },
          drawCreate: {
            startDraft: (args) => fxCreateShape1dDraftNode({ createShapeNode, point: args.point }),
            updateDraft: (previewNode, args) => {
              txUpdateShape1dDraftNode({
                previewNode,
                activeTool: "arrow",
                origin: args.origin,
                point: args.point,
                now,
                rememberedStyle: theme.getRememberedStyle("arrow"),
                updateShape,
              });
            },
          },
        });

        tool.registerTool({
          id: "line",
          label: "Line",
          icon: Minus,
          shortcuts: ["6", "l"],
          priority: 60,
          behavior: { type: "mode", mode: "draw-create" },
          drawCreate: {
            startDraft: (args) => fxCreateShape1dDraftNode({ createShapeNode, point: args.point }),
            updateDraft: (previewNode, args) => {
              txUpdateShape1dDraftNode({
                previewNode,
                activeTool: "line",
                origin: args.origin,
                point: args.point,
                now,
                rememberedStyle: theme.getRememberedStyle("line"),
                updateShape,
              });
            },
          },
        });
      });

      ctx.hooks.keydown.tap((event) => {
        if (event.key === "Escape"
          && selection.mode === CanvasMode.DRAW_CREATE
          && currentTool()
          && render.previewNode) {
          event.preventDefault();
          event.stopPropagation();
          render.clearPreviewState();
          tool.setActiveTool("select");
          return;
        }

        if (event.key === "Enter"
          && selection.mode === CanvasMode.SELECT
          && session.editingId === null) {
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

        if (event.key !== "Escape" || session.editingId === null) {
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
        if (selection.mode === CanvasMode.SELECT && session.editingId !== null && event.target === render.stage) {
          txExitShape1dEditMode(editModePortal);
        }
      });

      tool.hooks.activeToolChange.tap((toolId) => {
        if (toolId !== "select" && session.editingId !== null) {
          txExitShape1dEditMode(editModePortal, { preserveSelection: true });
        }
      });

      selection.hooks.change.tap(() => {
        txRefreshShape1dEditMode(editModePortal);
      });
      camera.hooks.change.tap(() => {
        txRefreshShape1dEditMode(editModePortal);
      });
      session.hooks.editingChange.tap(() => {
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
        txClearShape1dEditHandles(editModePortal);
        state.activeHandleDrag = null;
        state.moveSessions.clear();
        session.editingId = null;
        contextMenu.unregisterProvider("shape1d");
        unregisterLineElement();
        unregisterArrowElement();
        tool.unregisterTool("arrow");
        tool.unregisterTool("line");
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
  txCreateCloneDrag,
  txSetupShapeListeners,
};
