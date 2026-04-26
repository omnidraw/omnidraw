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
import { fnFilterSelection } from "../../core/fn.filter-selection";
import {
  fnCreateShape2dElement,
  fnGetShape2dDraftBounds,
  fnGetShape2dElementTypeFromTool,
  fnIsShape2dElementType,
  fnIsShape2dToolId,
  type TShape2dElementType,
  type TShape2dToolId,
} from "../../core/fn.shape2d";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import type {
  CameraService,
  ContextMenuService,
  CrdtService,
  ElementService,
  GroupService,
  HistoryService,
  RenderOrderService,
  SceneService,
  SelectionService,
  SessionService,
  ToolService,
} from "../../services";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { IRuntimeHooks } from "../../types";
import { txDeleteSelection } from "../select/tx.delete-selection";
import { DEFAULT_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import {
  DEFAULT_ATTACHED_TEXT_ALIGN,
  DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
  TEXT_FONT_SIZE_TOKEN_BY_PRESET,
} from "../text/CONSTANTS";
import { txEnterEditMode } from "../text/tx.enter-edit-mode";
import { fnGetShape2dNodeType } from "./fn.node";
import {
  fxGetAttachedTextNode,
  fxOpenAttachedTextEditMode,
  fxSyncAttachedTextNodeToShape,
} from "./fx.attached-text";
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

function getFocusedShape2dTextHost(selection: SelectionService) {
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

function getSelectionStyleMenuConfig(element?: TElement) {
  const defaults = fxGetShape2dToolDefaults();
  void element;

  return {
    sections: {
      showFillPicker: true,
      showStrokeColorPicker: true,
      showStrokeWidthPicker: true,
      showOpacityPicker: true,
      showTextPickers: true,
    },
    values: {
      fillColor: defaults.fillColor,
      strokeWidth: defaults.strokeWidth,
      opacity: defaults.opacity,
      fontFamily: "Arial, sans-serif" as const,
      fontSize: TEXT_FONT_SIZE_TOKEN_BY_PRESET.M,
      textAlign: DEFAULT_ATTACHED_TEXT_ALIGN,
      verticalAlign: DEFAULT_ATTACHED_TEXT_VERTICAL_ALIGN,
    },
    strokeWidthOptions: [...DEFAULT_STROKE_WIDTHS],
  };
}

export function createShape2dPlugin(): IPlugin<{
  camera: CameraService;
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  element: ElementService;
  group: GroupService;
  history: HistoryService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  session: SessionService;
  theme: ThemeService;
  tool: ToolService;
}, IRuntimeHooks> {
  return {
    name: "shape2d",
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

      const createAttachedTextReadPortal = () => ({
        Konva,
        scene: render,
      });

      const createAttachedTextSyncPortal = () => ({
        Konva,
        element,
        scene: render,
        theme,
      });

      const createAttachedTextEditPortal = () => ({
        ...createAttachedTextSyncPortal(),
        selection,
        session,
        enterEditMode: (args: { freeTextName: string; node: Konva.Text; isNew: boolean; shapeTextHostNode: Konva.Shape }) => {
          return txEnterEditMode({
            Konva,
            camera,
            element,
            session,
            crdt,
            document: render.container.ownerDocument,
            history,
            scene: render,
            selection,
            theme,
            pretext: { layoutWithLines, prepareWithSegments },
          }, args);
        },
      });

      const toElement = (node: Konva.Node) => {
        return fxToShape2dElement({
          Rect: Konva.Rect,
          Line: Konva.Line,
          Ellipse: Konva.Ellipse,
          now,
        }, {
          node,
        });
      };

      const createNode = (candidateElement: TElement) => {
        return fxCreateShape2dNode({
          Rect: Konva.Rect,
          Line: Konva.Line,
          Ellipse: Konva.Ellipse,
          theme,
          setNodeZIndex,
        }, {
          element: candidateElement,
        });
      };

      const syncShapeAttachedText = (shapeNode: Konva.Shape) => {
        return fxSyncAttachedTextNodeToShape(createAttachedTextSyncPortal(), { shapeNode });
      };

      const setupNode = (node: Konva.Shape) => {
        txSetupShape2dNode({
          Group: Konva.Group,
          Shape: Konva.Shape,
          element,
          crdt,
          history,
          render,
          selection,
          hooks: ctx.hooks,
          createCloneDrag: (sourceNode) => {
            return txCreateShape2dCloneDrag({
              Konva,
              element,
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
            return throttle((candidateElement: TElement) => {
              const builder = crdt.build();
              builder.patchElement(candidateElement.id, "x", candidateElement.x);
              builder.patchElement(candidateElement.id, "y", candidateElement.y);
              builder.patchElement(candidateElement.id, "updatedAt", candidateElement.updatedAt);
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

      const updateNodeFromElement = (candidateElement: TElement) => {
        const node = render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return isKonvaShape(candidate) && candidate.id() === candidateElement.id;
        });
        if (!isKonvaShape(node)) {
          return false;
        }

        const didUpdate = txUpdateShape2dNodeFromElement({
          Rect: Konva.Rect,
          Line: Konva.Line,
          Ellipse: Konva.Ellipse,
          theme,
          setNodeZIndex,
        }, {
          node,
          element: candidateElement,
        });
        if (!didUpdate) {
          return false;
        }

        if (isShape2dTextHostNode(node)) {
          syncShapeAttachedText(node);
        }

        return true;
      };

      const registerShapeElement = (args: {
        id: TShape2dToolId;
        type: TShape2dElementType;
        label: string;
        icon: string;
        shortcuts: string[];
        priority: number;
      }) => {
        return element.registerElement({
          id: args.id,
          matchesElement: (candidateElement) => candidateElement.data.type === args.type,
          matchesNode: (node) => {
            return fnGetShape2dNodeType({
              Rect: Konva.Rect,
              Line: Konva.Line,
              Ellipse: Konva.Ellipse,
              node,
            }) === args.type;
          },
          toElement: (node) => toElement(node),
          createNode: (candidateElement) => {
            if (candidateElement.data.type !== args.type) {
              return null;
            }

            return createNode(candidateElement);
          },
          getSelectionStyleMenu: ({ element: candidateElement }) => getSelectionStyleMenuConfig(candidateElement),
        });
      };

      renderOrder.registerBundleResolver("shape2d", (node) => {
        if (!isShape2dTextHostNode(node)) {
          return null;
        }

        const textNode = fxGetAttachedTextNode(createAttachedTextReadPortal(), { shapeNode: node });
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
            txDeleteSelection({ element, group, crdt, history, scene: render, renderOrder, selection }, {});
          },
        }];
      });

      const unregisterRectangle = registerShapeElement({
        id: "rect",
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
      const unregisterShapeRuntime = element.registerElement({
        id: "shape2d-runtime",
        priority: 100,
        matchesElement: (candidateElement) => fnIsShape2dElementType(candidateElement.data.type),
        matchesNode: (node) => isShape2dTextHostNode(node),
        afterCreateNode: ({ node }) => {
          if (isShape2dTextHostNode(node)) {
            syncShapeAttachedText(node);
          }
        },
        attachListeners: (node) => {
          if (!isShape2dTextHostNode(node)) {
            return false;
          }

          setupNode(node);
          return true;
        },
        updateElement: (candidateElement) => {
          if (!fnIsShape2dElementType(candidateElement.data.type)) {
            return false;
          }

          return updateNodeFromElement(candidateElement);
        },
        createDragClone: ({ node }) => {
          if (!isShape2dTextHostNode(node)) {
            return false;
          }

          txCreateShape2dCloneDrag({
            Konva,
            element,
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

      const offToolChange = tool.hooks.activeToolChange.tap((toolId) => {
        if (fnIsShape2dToolId(toolId)) {
          selection.clear();
        }
      });

      ctx.hooks.init.tap(() => {
        [
          {
            id: "rect" as const,
            label: "Rectangle",
            icon: Square,
            shortcuts: ["2", "r"],
            priority: 20,
          },
          {
            id: "diamond" as const,
            label: "Diamond",
            icon: Diamond,
            shortcuts: ["3", "d"],
            priority: 30,
          },
          {
            id: "ellipse" as const,
            label: "Ellipse",
            icon: Circle,
            shortcuts: ["4", "o"],
            priority: 40,
          },
        ].forEach((toolDefinition) => {
          tool.registerTool({
            id: toolDefinition.id,
            label: toolDefinition.label,
            icon: toolDefinition.icon,
            shortcuts: toolDefinition.shortcuts,
            priority: toolDefinition.priority,
            behavior: { type: "mode", mode: "draw-create" },
            drawCreate: {
              startDraft: ({ point }) => {
                const timestamp = now();
                const node = createNode(fxApplyRememberedShape2dToolStyle({
                  element: fnCreateShape2dElement({
                    id: `shape2d-draft-${toolDefinition.id}`,
                    type: fnGetShape2dElementTypeFromTool(toolDefinition.id),
                    x: point.x,
                    y: point.y,
                    rotation: 0,
                    width: 0,
                    height: 0,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    parentGroupId: null,
                    zIndex: "",
                  }),
                  rememberedStyle: theme.getRememberedStyle(toolDefinition.id),
                }));

                if (!node) {
                  return null;
                }

                node.draggable(false);
                node.listening(false);
                return node;
              },
              updateDraft: (previewNode, args) => {
                const currentElement = toElement(previewNode);
                const bounds = fnGetShape2dDraftBounds({
                  origin: args.origin,
                  point: args.point,
                  preserveRatio: args.shiftKey,
                });
                const nextElement = fnCreateShape2dElement({
                  id: previewNode.id(),
                  type: fnGetShape2dElementTypeFromTool(toolDefinition.id),
                  x: bounds.x,
                  y: bounds.y,
                  rotation: 0,
                  width: bounds.width,
                  height: bounds.height,
                  createdAt: currentElement?.createdAt ?? args.now,
                  updatedAt: args.now,
                  parentGroupId: null,
                  zIndex: "",
                  style: currentElement?.style,
                });

                txUpdateShape2dNodeFromElement({
                  Rect: Konva.Rect,
                  Line: Konva.Line,
                  Ellipse: Konva.Ellipse,
                  theme,
                  setNodeZIndex,
                }, {
                  node: previewNode,
                  element: nextElement,
                });
                previewNode.draggable(false);
                previewNode.listening(false);
                render.dynamicLayer.batchDraw();
              },
            },
          });
        });
      });

      ctx.hooks.pointerCancel.tap(() => {
        if (selection.mode !== CanvasMode.DRAW_CREATE) {
          return;
        }

        if (!fnIsShape2dToolId(tool.activeToolId)) {
          return;
        }

        if (!render.previewNode) {
          return;
        }

        render.clearPreviewState();
        render.dynamicLayer.batchDraw();
      });

      ctx.hooks.elementPointerDoubleClick.tap((event) => {
        if (!isShape2dTextHostNode(event.currentTarget)) {
          return false;
        }

        return fxOpenAttachedTextEditMode(createAttachedTextEditPortal(), { shapeNode: event.currentTarget });
      });

      ctx.hooks.keydown.tap((event) => {
        if (event.key === "Escape") {
          if (selection.mode !== CanvasMode.DRAW_CREATE) {
            return;
          }

          if (!fnIsShape2dToolId(tool.activeToolId) || !render.previewNode) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          render.clearPreviewState();
          render.dynamicLayer.batchDraw();
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

        const shapeNode = getFocusedShape2dTextHost(selection);
        if (!shapeNode) {
          return;
        }

        if (fnIsShape2dToolId(tool.activeToolId) && !render.previewNode) {
          tool.setActiveTool("select");
        }

        event.preventDefault();
        event.stopPropagation();
        fxOpenAttachedTextEditMode(createAttachedTextEditPortal(), { shapeNode });
      });

      theme.hooks.change.tap(() => {
        render.staticForegroundLayer.find((candidate: Konva.Node) => {
          return isKonvaShape(candidate) && fnGetShape2dNodeType({ Rect: Konva.Rect, Line: Konva.Line, Ellipse: Konva.Ellipse, node: candidate }) !== null;
        }).forEach((candidate) => {
          if (!isKonvaShape(candidate)) {
            return;
          }

          const candidateElement = element.toElement(candidate);
          if (!candidateElement || !fnIsShape2dElementType(candidateElement.data.type)) {
            return;
          }

          txUpdateShape2dNodeFromElement({
            Rect: Konva.Rect,
            Line: Konva.Line,
            Ellipse: Konva.Ellipse,
            theme,
            setNodeZIndex,
          }, {
            node: candidate,
            element: candidateElement,
          });
        });
        render.staticForegroundLayer.batchDraw();
      });

      ctx.hooks.destroy.tap(() => {
        offToolChange();
        render.clearPreviewState();
        contextMenu.unregisterProvider("shape2d");
        renderOrder.unregisterBundleResolver("shape2d");
        unregisterShapeRuntime();
        unregisterRectangle();
        unregisterDiamond();
        unregisterEllipse();
        tool.unregisterTool("rect");
        tool.unregisterTool("diamond");
        tool.unregisterTool("ellipse");
      });
    },
  };
}
