import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import { throttle } from "@solid-primitives/scheduled";
import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import Circle from "lucide-static/icons/circle.svg?raw";
import Diamond from "lucide-static/icons/diamond.svg?raw";
import Square from "lucide-static/icons/square.svg?raw";
import { isKonvaGroup, isKonvaShape } from "../../core/GUARDS";
import {
    fnCreateShape2dElement,
    fnGetShape2dDraftBounds,
    fnGetShape2dElementTypeFromTool,
    fnGetShape2dTextData,
    fnIsShape2dElementType,
    fnIsShape2dToolId,
    type TShape2dElementType,
    type TShape2dToolId,
} from "../../core/fn.shape2d";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
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
import type { IRuntimeHooks } from "../../types";
import { txDeleteSelection } from "../select/tx.delete-selection";
import { txEnterEditMode } from "../text/tx.enter-edit-mode";
import {
  DEFAULT_ATTACHED_TEXT_ALIGN,
  DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
  TEXT_FONT_SIZE_TOKEN_BY_PRESET,
} from "../text/CONSTANTS";
import { fnGetShape2dNodeType } from "./fn.node";
import { fxGetAttachedTextNode, fxOpenAttachedTextEditMode, fxSyncAttachedTextNodeToShape } from "./fx.attached-text";
import { fxCreateShape2dNode } from "./fx.create-node";
import { fxToShape2dElement } from "./fx.to-element";
import { txCreateShape2dCloneDrag } from "./tx.create-clone-drag";
import { txSetupShape2dNode } from "./tx.setup-node";
import { txUpdateShape2dNodeFromElement } from "./tx.update-node-from-element";

const setNodeZIndex = (node: Konva.Group | Konva.Shape, zIndex: string) => txSetNodeZIndex({}, { node, zIndex });

function createCreateId(render: SceneService) {
  let fallbackId = 0;

  return () => {
    const cryptoApi = render.container.ownerDocument.defaultView?.crypto;
    if (cryptoApi?.randomUUID) {
      return cryptoApi.randomUUID();
    }

    fallbackId += 1;
    return `shape2d-${Date.now()}-${fallbackId}`;
  };
}

function safeStopDrag(node: Konva.Node) {
  try {
    if (node.isDragging()) {
      node.stopDrag();
    }
  } catch {
    return;
  }
}

function isShape2dTextHostNode(node: Konva.Node | null | undefined): node is Konva.Shape {
  return Boolean(node)
    && isKonvaShape(node)
    && fnGetShape2dNodeType({ Rect: Konva.Rect, Line: Konva.Line, Ellipse: Konva.Ellipse, node }) !== null;
}

function getFocusedShape2dTextHost(canvasRegistry: CanvasRegistryService, selection: SelectionService) {
  const filtered = fnFilterSelection({ selection: selection.selection });
  if (filtered.length !== 1) {
    return null;
  }

  const candidate = filtered[0];
  return isShape2dTextHostNode(candidate) ? candidate : null;
}

const DEFAULT_SHAPE2D_FILL_COLOR_TOKEN = "@base/300";
const DEFAULT_SHAPE2D_STROKE_WIDTH = "@stroke-width/none";
const DEFAULT_SHAPE2D_OPACITY = 1;

export function fxGetShape2dToolDefaults() {
  return {
    fillColor: DEFAULT_SHAPE2D_FILL_COLOR_TOKEN,
    strokeWidth: DEFAULT_SHAPE2D_STROKE_WIDTH,
    opacity: DEFAULT_SHAPE2D_OPACITY,
  };
}

export function fxApplyRememberedShape2dToolStyle(args: {
  element: TElement;
  rememberedStyle: {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: string;
    opacity?: number;
  };
}) {
  const defaults = fxGetShape2dToolDefaults();
  const nextElement = structuredClone(args.element);

  if (typeof nextElement.style.backgroundColor !== "string") {
    nextElement.style.backgroundColor = defaults.fillColor;
  }

  if (typeof nextElement.style.strokeWidth !== "string") {
    nextElement.style.strokeWidth = defaults.strokeWidth;
  }

  if (typeof nextElement.style.opacity !== "number") {
    nextElement.style.opacity = defaults.opacity;
  }

  const rememberedFillColor = args.rememberedStyle.fillColor;
  if (typeof rememberedFillColor === "string") {
    nextElement.style.backgroundColor = rememberedFillColor;
  }

  const rememberedStrokeColor = args.rememberedStyle.strokeColor;
  if (typeof rememberedStrokeColor === "string") {
    nextElement.style.strokeColor = rememberedStrokeColor;
  }

  const rememberedStrokeWidth = args.rememberedStyle.strokeWidth;
  if (typeof rememberedStrokeWidth === "string") {
    nextElement.style.strokeWidth = rememberedStrokeWidth;
  }

  const rememberedOpacity = args.rememberedStyle.opacity;
  if (typeof rememberedOpacity === "number") {
    nextElement.style.opacity = rememberedOpacity;
  }

  return nextElement;
}

function getSelectionStyleMenuConfig(args?: {
  theme?: ThemeService;
  element?: TElement;
}) {
  const defaults = fxGetShape2dToolDefaults();
  const hasInlineText = args?.element ? fnGetShape2dTextData(args.element) !== null : false;

  return {
    sections: {
      showFillPicker: true,
      showStrokeColorPicker: true,
      showStrokeWidthPicker: true,
      showOpacityPicker: true,
      showTextPickers: hasInlineText,
    },
    values: {
      fillColor: defaults.fillColor,
      strokeWidth: defaults.strokeWidth,
      opacity: defaults.opacity,
      fontFamily: "Arial, sans-serif",
      fontSize: TEXT_FONT_SIZE_TOKEN_BY_PRESET.M,
      textAlign: DEFAULT_ATTACHED_TEXT_ALIGN,
      verticalAlign: DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
    },
  };
}

export function createShape2dPlugin(): IPlugin<{
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
  return {
    name: "shape2d",
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
      const createId = createCreateId(render);
      const now = () => Date.now();

      const createAttachedTextPortal = () => ({
        Konva,
        canvasRegistry,
        editor,
        scene: render,
        selection,
        theme,
        enterEditMode: (args: { freeTextName: string; node: Konva.Text; isNew: boolean; shapeTextHostNode: Konva.Shape }) => {
          return txEnterEditMode({
            Konva,
            camera,
            canvasRegistry,
            crdt,
            document: render.container.ownerDocument,
            editor,
            history,
            scene: render,
            selection,
            theme,
            pretext: { layoutWithLines, prepareWithSegments },
          }, args);
        },
      });

      let previewNode: Konva.Shape | null = null;
      let previewOrigin: { x: number; y: number } | null = null;
      let previewToolId: TShape2dToolId | null = null;

      const toElement = (node: Konva.Node) => {
        return fxToShape2dElement({
          Rect: Konva.Rect,
          Line: Konva.Line,
          Ellipse: Konva.Ellipse,
          canvasRegistry,
          render,
          now,
        }, {
          node,
        });
      };

      const createNode = (element: TElement) => {
        return fxCreateShape2dNode({
          Rect: Konva.Rect,
          Line: Konva.Line,
          Ellipse: Konva.Ellipse,
          render,
          theme,
          setNodeZIndex,
        }, {
          element,
        });
      };

      const applyElement = (element: TElement) => {
        canvasRegistry.updateElement(element);
      };

      const syncShapeAttachedText = (shapeNode: Konva.Shape) => {
        return fxSyncAttachedTextNodeToShape(createAttachedTextPortal(), { shapeNode });
      };

      const setupNode = (node: Konva.Shape) => {
        txSetupShape2dNode({
          Group: Konva.Group,
          Shape: Konva.Shape,
          canvasRegistry,
          crdt,
          history,
          render,
          selection,
          hooks: ctx.hooks,
          createCloneDrag: (sourceNode) => {
            return txCreateShape2dCloneDrag({
              Konva,
              canvasRegistry,
              crdt,
              history,
              render,
              renderOrder,
              selection,
              createId,
              now,
              createNode,
              setupNode,
              toElement,
            }, {
              node: sourceNode,
            });
          },
          filterSelection: (nodes) => {
            return fnFilterSelection({
              selection: nodes.filter((candidate): candidate is Konva.Group | Konva.Shape => {
                return isKonvaGroup(candidate) || isKonvaShape(candidate);
              }),
            });
          },
          safeStopDrag,
          toElement,
          createThrottledPatch: () => {
            return throttle((element: TElement) => {
              const builder = crdt.build();
              builder.patchElement(element.id, "x", element.x);
              builder.patchElement(element.id, "y", element.y);
              builder.patchElement(element.id, "updatedAt", element.updatedAt);
              builder.commit();
            }, 100);
          },
          onNodeDragMove: (dragNode) => {
            if (isShape2dTextHostNode(dragNode)) {
              syncShapeAttachedText(dragNode);
            }
          },
          onNodeDragEnd: (dragNode) => {
            if (isShape2dTextHostNode(dragNode)) {
              syncShapeAttachedText(dragNode);
            }
          },
          onNodeTransform: (transformNode) => {
            if (isShape2dTextHostNode(transformNode)) {
              syncShapeAttachedText(transformNode);
            }
          },
        }, {
          node,
        });
        return node;
      };

      const clearPreviewState = () => {
        previewNode = null;
        previewOrigin = null;
        previewToolId = null;
      };

      const destroyPreview = () => {
        previewNode?.destroy();
        clearPreviewState();
        render.dynamicLayer.batchDraw();
      };

      const cancelCreate = () => {
        destroyPreview();
        editor.setActiveTool("select");
      };

      const commitPreview = () => {
        if (!previewNode) {
          return;
        }

        const createdNode = previewNode;
        clearPreviewState();
        createdNode.moveTo(render.staticForegroundLayer);
        setupNode(createdNode);
        syncShapeAttachedText(createdNode);
        renderOrder.assignOrderOnInsert({
          parent: render.staticForegroundLayer,
          nodes: [createdNode],
          position: "front",
        });

        const element = toElement(createdNode);
        if (!element) {
          createdNode.destroy();
          editor.setActiveTool("select");
          render.staticForegroundLayer.batchDraw();
          return;
        }

        const builder = crdt.build();
        builder.patchElement(element.id, element);
        builder.commit();
        selection.setSelection([createdNode]);
        selection.setFocusedNode(createdNode);
        editor.setActiveTool("select");
        render.dynamicLayer.batchDraw();
        render.staticForegroundLayer.batchDraw();
      };

      const registerShapeElement = (args: {
        id: TShape2dToolId;
        type: TShape2dElementType;
        label: string;
        icon: string;
        shortcuts: string[];
        priority: number;
      }) => {
        editor.registerTool({
          id: args.id,
          label: args.label,
          icon: args.icon,
          shortcuts: args.shortcuts,
          priority: args.priority,
          behavior: { type: "mode", mode: "draw-create" },
        });

        return canvasRegistry.registerElement({
          id: args.id,
          matchesElement: (element) => element.data.type === args.type,
          matchesNode: (node) => fnGetShape2dNodeType({ Rect: Konva.Rect, Line: Konva.Line, Ellipse: Konva.Ellipse, node }) === args.type,
          toElement: (node) => toElement(node),
          createNode: (element) => {
            if (element.data.type !== args.type) {
              return null;
            }

            return createNode(element);
          },
          getSelectionStyleMenu: ({ theme: activeTheme, element }) => getSelectionStyleMenuConfig({ theme: activeTheme, element }),
        });
      };

      renderOrder.registerBundleResolver("shape2d", (node) => {
        if (!isShape2dTextHostNode(node)) {
          return null;
        }

        const textNode = fxGetAttachedTextNode(createAttachedTextPortal(), { shapeNode: node });
        if (!textNode || textNode.getParent() !== node.getParent()) {
          return [node];
        }

        return [node, textNode];
      });

      contextMenu.registerProvider("shape2d", ({ targetElement, activeSelection }) => {
        if (!targetElement || !fnIsShape2dElementType(targetElement.data.type)) {
          return [];
        }

        return [{
          id: "delete-shape2d-selection",
          label: "Delete",
          priority: 300,
          onSelect: () => {
            selection.setSelection(activeSelection);
            txDeleteSelection({ canvasRegistry, crdt, history, render, renderOrder, selection }, {});
          },
        }];
      });

      const unregisterRectangle = registerShapeElement({
        id: "rectangle",
        type: "rect",
        label: "Rectangle",
        icon: Square,
        shortcuts: ["2", "r"],
        priority: 20,
      });
      const unregisterDiamond = registerShapeElement({
        id: "diamond",
        type: "diamond",
        label: "Diamond",
        icon: Diamond,
        shortcuts: ["3", "d"],
        priority: 30,
      });
      const unregisterEllipse = registerShapeElement({
        id: "ellipse",
        type: "ellipse",
        label: "Ellipse",
        icon: Circle,
        shortcuts: ["4", "o"],
        priority: 40,
      });
      const unregisterShapeRuntime = canvasRegistry.registerElement({
        id: "shape2d-runtime",
        priority: 100,
        matchesElement: (element) => fnIsShape2dElementType(element.data.type),
        matchesNode: (node) => isShape2dTextHostNode(node),
        attachListeners: (node) => {
          if (!isShape2dTextHostNode(node)) {
            return false;
          }

          setupNode(node);
          return true;
        },
        updateElement: (element) => {
          if (!fnIsShape2dElementType(element.data.type)) {
            return false;
          }

          const node = render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
            return isKonvaShape(candidate) && candidate.id() === element.id;
          });
          if (!isKonvaShape(node)) {
            return false;
          }

          const didUpdate = txUpdateShape2dNodeFromElement({
            Rect: Konva.Rect,
            Line: Konva.Line,
            Ellipse: Konva.Ellipse,
            render,
            theme,
            setNodeZIndex,
          }, {
            node,
            element,
          });
          if (!didUpdate) {
            return false;
          }

          if (isShape2dTextHostNode(node)) {
            syncShapeAttachedText(node);
          }

          return true;
        },
        createDragClone: ({ node }) => {
          if (!isShape2dTextHostNode(node)) {
            return false;
          }

          txCreateShape2dCloneDrag({
            Konva,
            canvasRegistry,
            crdt,
            history,
            render,
            renderOrder,
            selection,
            createId,
            now,
            createNode,
            setupNode,
            toElement,
          }, {
            node,
          });
          return true;
        },
      });

      ctx.hooks.toolSelect.tap((toolId) => {
        if (previewNode && toolId !== previewToolId) {
          destroyPreview();
        }

        if (fnIsShape2dToolId(toolId)) {
          selection.clear();
        }
      });

      ctx.hooks.pointerDown.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!fnIsShape2dToolId(editor.activeToolId)) {
          return;
        }

        if (previewNode) {
          return;
        }

        const pointer = render.dynamicLayer.getRelativePointerPosition();
        if (!pointer) {
          return;
        }

        const timestamp = now();
        const element = fxApplyRememberedShape2dToolStyle({
          element: fnCreateShape2dElement({
            id: createId(),
            type: fnGetShape2dElementTypeFromTool(editor.activeToolId),
            x: pointer.x,
            y: pointer.y,
            rotation: 0,
            width: 0,
            height: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
            parentGroupId: null,
            zIndex: "",
          }),
          rememberedStyle: theme.getRememberedStyle(editor.activeToolId),
        });
        const node = createNode(element);
        if (!node) {
          return;
        }

        node.draggable(false);
        node.listening(false);
        previewNode = node;
        previewOrigin = { x: pointer.x, y: pointer.y };
        previewToolId = editor.activeToolId;
        render.dynamicLayer.add(node);
        render.dynamicLayer.batchDraw();
      });

      ctx.hooks.pointerMove.tap((event) => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!previewNode || !previewOrigin || !previewToolId) {
          return;
        }

        const pointer = render.dynamicLayer.getRelativePointerPosition();
        if (!pointer) {
          return;
        }

        const currentElement = toElement(previewNode);
        const bounds = fnGetShape2dDraftBounds({
          origin: previewOrigin,
          point: pointer,
          preserveRatio: event.evt.shiftKey,
        });
        const timestamp = now();
        const nextElement = fnCreateShape2dElement({
          id: previewNode.id(),
          type: fnGetShape2dElementTypeFromTool(previewToolId),
          x: bounds.x,
          y: bounds.y,
          rotation: 0,
          width: bounds.width,
          height: bounds.height,
          createdAt: currentElement?.createdAt ?? Number(previewNode.getAttr("vcElementCreatedAt") ?? timestamp),
          updatedAt: timestamp,
          parentGroupId: null,
          zIndex: "",
          style: currentElement?.style,
        });

        txUpdateShape2dNodeFromElement({
          Rect: Konva.Rect,
          Line: Konva.Line,
          Ellipse: Konva.Ellipse,
          render,
          theme,
          setNodeZIndex,
        }, {
          node: previewNode,
          element: nextElement,
        });
        previewNode.draggable(false);
        previewNode.listening(false);
        render.dynamicLayer.batchDraw();
      });

      ctx.hooks.pointerUp.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!previewNode || !previewToolId) {
          return;
        }

        commitPreview();
      });

      ctx.hooks.elementPointerDoubleClick.tap((event) => {
        if (!isShape2dTextHostNode(event.currentTarget)) {
          return false;
        }

        return fxOpenAttachedTextEditMode(createAttachedTextPortal(), { shapeNode: event.currentTarget });
      });

      ctx.hooks.pointerCancel.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!previewNode) {
          return;
        }

        cancelCreate();
      });

      ctx.hooks.keydown.tap((event) => {
        if (event.key === "Escape") {
          if (selection.mode !== CanvasMode.DRAW_CREATE) {
            return;
          }

          if (!previewNode) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          cancelCreate();
          return;
        }

        if (event.key !== "Enter") {
          return;
        }

        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          return;
        }

        if (target instanceof HTMLElement && target.isContentEditable) {
          return;
        }

        const shapeNode = getFocusedShape2dTextHost(canvasRegistry, selection);
        if (!shapeNode) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        fxOpenAttachedTextEditMode(createAttachedTextPortal(), { shapeNode });
      });

      theme.hooks.change.tap(() => {
        render.staticForegroundLayer.find((candidate: Konva.Node) => {
          return isKonvaShape(candidate) && fnGetShape2dNodeType({ Rect: Konva.Rect, Line: Konva.Line, Ellipse: Konva.Ellipse, node: candidate }) !== null;
        }).forEach((candidate) => {
          if (!isKonvaShape(candidate)) {
            return;
          }

          const element = canvasRegistry.toElement(candidate);
          if (!element || !fnIsShape2dElementType(element.data.type)) {
            return;
          }

          txUpdateShape2dNodeFromElement({
            Rect: Konva.Rect,
            Line: Konva.Line,
            Ellipse: Konva.Ellipse,
            render,
            theme,
            setNodeZIndex,
          }, {
            node: candidate,
            element,
          });
        });
        render.staticForegroundLayer.batchDraw();
      });

      ctx.hooks.destroy.tap(() => {
        destroyPreview();
        contextMenu.unregisterProvider("shape2d");
        renderOrder.unregisterBundleResolver("shape2d");
        unregisterShapeRuntime();
        unregisterRectangle();
        unregisterDiamond();
        unregisterEllipse();
        editor.unregisterTool("rectangle");
        editor.unregisterTool("diamond");
        editor.unregisterTool("ellipse");
      });
    },
  };
}
