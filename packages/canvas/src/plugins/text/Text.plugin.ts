import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";
import { throttle } from "@solid-primitives/scheduled";
import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement, TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { resolveThemeColor, type ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import Type from "lucide-static/icons/type.svg?raw";
import { ELEMENT_DATA_ATTR, VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR } from "../../core/CONSTANTS";
import { isKonvaText } from "../../core/GUARDS";
import { txFinalizeOwnedTransform } from "../../core/tx.finalize-owned-transform";
import type {
  CameraService,
  ContextMenuService,
  CrdtService,
  ElementService,
  GroupService,
  HistoryService,
  RenderOrderService, SceneService,
  SelectionService,
  SessionService,
  TCanvasTransformAnchor,
  ToolService
} from "../../services";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import type { IRuntimeHooks } from "../../types";
import { txDeleteSelection } from "../select/tx.delete-selection";
import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE_TOKEN,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_VERTICAL_ALIGN,
} from "./CONSTANTS";
import { fnCreateTextElement } from "./fn.create-text-element";
import { fxToTextElement } from "./fx.to-text-element";
import { txCreateTextCloneDrag } from "./tx.create-text-clone-drag";
import { txEnterEditMode } from "./tx.enter-edit-mode";
import { txSetupTextNode } from "./tx.setup-text-node";
import { txUpdateTextNodeFromElement } from "./tx.update-text-node-from-element";

const FREE_TEXT_NAME = "free-text";
const TEXT_USES_THEME_COLOR_ATTR = "vcUsesThemeTextColor";
const ELEMENT_STYLE_ATTR = "vcElementStyle";
const TRANSFORM_BEFORE_ELEMENT_ATTR = "vcTransformBeforeElement";
const TEXT_TRANSFORM_ANCHORS: TCanvasTransformAnchor[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const DEFAULT_TEXT_COLOR_TOKEN = "@base/900";

function usesThemeTextColor(element: Pick<TElement, "style">) {
  return !element.style.strokeColor;
}

function getTextFillColor(theme: ThemeService, element: Pick<TElement, "style">) {
  return resolveThemeColor(theme.getTheme(), element.style.strokeColor, theme.getTheme().colors.canvasText) ?? theme.getTheme().colors.canvasText;
}

function applyTextThemeState(node: Konva.Text, element: Pick<TElement, "style">) {
  node.setAttr(TEXT_USES_THEME_COLOR_ATTR, usesThemeTextColor(element));
}

function createTextNode(theme: ThemeService, element: TElement) {
  const data = element.data as TTextData;
  if (data.containerId !== null) {
    return null;
  }

  const node = new Konva.Text({
    id: element.id,
    x: element.x,
    y: element.y,
    rotation: element.rotation,
    width: data.w,
    height: data.h,
    text: data.text,
    fontSize: theme.resolveFontSize(element.style.fontSize),
    fontFamily: data.fontFamily,
    align: element.style.textAlign ?? DEFAULT_TEXT_ALIGN,
    verticalAlign: element.style.verticalAlign ?? DEFAULT_TEXT_VERTICAL_ALIGN,
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    wrap: "none",
    draggable: true,
    listening: true,
    fill: getTextFillColor(theme, element),
    opacity: element.style.opacity ?? 1,
    scaleX: element.scaleX ?? 1,
    scaleY: element.scaleY ?? 1,
  });

  applyTextThemeState(node, element);
  node.setAttr(ELEMENT_DATA_ATTR, structuredClone(element.data));
  node.setAttr(ELEMENT_STYLE_ATTR, structuredClone(element.style));
  node.setAttr(VC_CREATED_AT_ATTR, element.createdAt);
  node.setAttr(VC_UPDATED_AT_ATTR, element.updatedAt);
  node.setAttr("vcContainerId", null);
  node.setAttr("vcOriginalText", data.originalText);
  node.setAttr("vcTextAutoResize", data.autoResize);
  node.name(FREE_TEXT_NAME);
  return node;
}

function fxApplyRememberedTextToolStyle(args: {
  element: TElement;
  rememberedStyle: {
    strokeColor?: string;
    opacity?: number;
    fontFamily?: string;
    fontSize?: string;
    textAlign?: TElement["style"]["textAlign"];
    verticalAlign?: TElement["style"]["verticalAlign"];
  };
}) {
  const nextElement = structuredClone(args.element);
  const rememberedStrokeColor = args.rememberedStyle.strokeColor;
  if (typeof rememberedStrokeColor === "string") {
    nextElement.style.strokeColor = rememberedStrokeColor;
  }

  const rememberedOpacity = args.rememberedStyle.opacity;
  if (typeof rememberedOpacity === "number") {
    nextElement.style.opacity = rememberedOpacity;
  }

  if (nextElement.data.type !== "text") {
    return nextElement;
  }

  const rememberedFontFamily = args.rememberedStyle.fontFamily;
  if (typeof rememberedFontFamily === "string") {
    nextElement.data.fontFamily = rememberedFontFamily;
  }

  const rememberedFontSize = args.rememberedStyle.fontSize;
  if (typeof rememberedFontSize === "string") {
    nextElement.style.fontSize = rememberedFontSize;
  }


  const rememberedTextAlign = args.rememberedStyle.textAlign;
  if (rememberedTextAlign === "left" || rememberedTextAlign === "center" || rememberedTextAlign === "right") {
    nextElement.style.textAlign = rememberedTextAlign;
  }

  const rememberedVerticalAlign = args.rememberedStyle.verticalAlign;
  if (rememberedVerticalAlign === "top" || rememberedVerticalAlign === "middle" || rememberedVerticalAlign === "bottom") {
    nextElement.style.verticalAlign = rememberedVerticalAlign;
  }

  return nextElement;
}

function txApplyTextTransform(args: {
  node: Konva.Node;
}) {
  return isKonvaText(args.node);
}

/**
 * Owns standalone free-text create, edit, drag, clone-drag, and transform flows.
 */
export function createTextPlugin(): IPlugin<{
  camera: CameraService;
  element: ElementService;
  group: GroupService;
  contextMenu: ContextMenuService;
  crdt: CrdtService;
  history: HistoryService;
  scene: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: ThemeService;
  session: SessionService;
  tool: ToolService;
}, IRuntimeHooks> {
  return {
    name: "text",
    apply(ctx) {
      const camera = ctx.services.require("camera");
      const element = ctx.services.require("element");
      const group = ctx.services.require("group");
      const session = ctx.services.require("session");
      const contextMenu = ctx.services.require("contextMenu");
      const crdt = ctx.services.require("crdt");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const renderOrder = ctx.services.require("renderOrder");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      const document = scene.container.ownerDocument;
      const tool = ctx.services.require("tool");
      const createId = () => crypto.randomUUID();
      const now = () => Date.now();

      const syncThemeTextNodes = () => {
        scene.staticForegroundLayer.find((candidate: Konva.Node) => {
          return isKonvaText(candidate) && candidate.name() === FREE_TEXT_NAME;
        }).forEach((candidate) => {
          if (!isKonvaText(candidate)) {
            return;
          }

          const el = element.toElement(candidate);
          if (!el || el.data.type !== "text") {
            return;
          }

          txUpdateTextNodeFromElement({
            Konva,
            scene,
            theme,
          }, {
            element: el,
            freeTextName: FREE_TEXT_NAME,
          });
        });
        scene.staticForegroundLayer.batchDraw();
      };

      const setupNode = (node: Konva.Text) => {
        txSetupTextNode({
          Konva,
          crdt,
          history,
          hooks: ctx.hooks,
          render: scene,
          selection,
          serializeNode: ({ node, createdAt, updatedAt }) => fxToTextElement({Date}, { node }),
          theme,
          now,
          startDragClone: (args) => element.createDragClone(args),
          createThrottledPatch: (callback) => throttle(callback, 100),
        }, {
          freeTextName: FREE_TEXT_NAME,
          node,
        });
        return node;
      };

      const applyElement = (el: TElement) => {
        element.updateElement(el);
        scene.staticForegroundLayer.batchDraw();
      };

      const unregisterTextElement = element.registerElement({
        id: "text",
        matchesElement: (element) => element.data.type === "text" && element.data.containerId === null,
        matchesNode: (node) => isKonvaText(node) && node.name() === FREE_TEXT_NAME,
        toElement: (node) => {
          if (!isKonvaText(node)) {
            return null;
          }

          return fxToTextElement({ Date }, { node, });
        },
        createNode: (element) => {
          if (element.data.type !== "text" || element.data.containerId !== null) {
            return null;
          }

          return createTextNode(theme, element);
        },
        createDragClone: ({ node }) => {
          if (!isKonvaText(node) || node.name() !== FREE_TEXT_NAME) {
            return false;
          }

          const el = element.toElement(node);
          if (!el || el.data.type !== "text" || el.data.containerId !== null) {
            return false;
          }

          txCreateTextCloneDrag({
            Konva,
            crdt,
            render: scene,
            selection,
            createId,
            now,
            serializeNode: ({ node: candidateNode, createdAt, updatedAt }) => fxToTextElement({ Date }, { node: candidateNode, }),
            setupNode,
          }, {
            freeTextName: FREE_TEXT_NAME,
            node,
          });
          return true;
        },
        attachListeners: (node) => {
          if (!isKonvaText(node) || node.name() !== FREE_TEXT_NAME) {
            return false;
          }

          setupNode(node);
          return true;
        },
        updateElement: (element) => {
          if (element.data.type !== "text" || element.data.containerId !== null) {
            return false;
          }

          return txUpdateTextNodeFromElement({
            Konva,
            scene,
            theme,
          }, {
            element,
            freeTextName: FREE_TEXT_NAME,
          });
        },
        getSelectionStyleMenu: ({ theme: activeTheme }) => ({
          sections: {
            showStrokeColorPicker: true,
            showTextPickers: true,
            showOpacityPicker: true,
          },
          values: {
            strokeColor: DEFAULT_TEXT_COLOR_TOKEN,
            opacity: 1,
            fontFamily: `${DEFAULT_TEXT_FONT_FAMILY}, sans-serif`,
            fontSize: DEFAULT_TEXT_FONT_SIZE_TOKEN,
            textAlign: DEFAULT_TEXT_ALIGN,
            verticalAlign: DEFAULT_TEXT_VERTICAL_ALIGN,
          },
        }),
        getTransformOptions: ({ element }) => {
          if (element.data.type !== "text" || element.data.containerId !== null) {
            return;
          }

          return {
            enabledAnchors: [...TEXT_TRANSFORM_ANCHORS],
            keepRatio: true,
          };
        },
        onResize: ({ node, element }) => {
          if (element.data.type !== "text" || element.data.containerId !== null) {
            return;
          }

          txApplyTextTransform({ node });
          return {
            cancel: false,
            crdt: false,
          };
        },
        afterResize: ({ node, element }) => {
          if (!isKonvaText(node) || element.data.type !== "text" || element.data.containerId !== null) {
            return;
          }

          txApplyTextTransform({ node });
          return {
            cancel: txFinalizeOwnedTransform({
              crdt,
              history,
              applyElement,
              serializeAfterElement: (candidateNode, beforeElement) => {
                if (!isKonvaText(candidateNode)) {
                  return null;
                }

                return fxToTextElement({ Date }, { node: candidateNode, });
              },
            }, {
              node,
              label: "transform-text",
              beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
            }),
            crdt: false,
          };
        },
        afterRotate: ({ node, element }) => {
          if (!isKonvaText(node) || element.data.type !== "text" || element.data.containerId !== null) {
            return;
          }

          return {
            cancel: txFinalizeOwnedTransform({
              crdt,
              history,
              applyElement,
              serializeAfterElement: (candidateNode, beforeElement) => {
                if (!isKonvaText(candidateNode)) {
                  return null;
                }

                return fxToTextElement({Date}, { node: candidateNode });
              },
            }, {
              node,
              label: "rotate-text",
              beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
            }),
            crdt: false,
          };
        },
      });

      contextMenu.registerProvider("text", ({ targetElement, activeSelection }) => {
        if (targetElement?.data.type !== "text" || targetElement.data.containerId !== null) {
          return [];
        }

        return [{
          id: "delete-text-selection",
          label: "Delete",
          priority: 300,
          onSelect: () => {
            selection.setSelection(activeSelection);
            txDeleteSelection({ element, group, crdt, history, scene, renderOrder, selection }, {});
          },
        }];
      });

      ctx.hooks.init.tap(() => {
        tool.registerTool({
          id: "text",
          label: "Text",
          icon: Type,
          shortcuts: ["t"],
          priority: 50,
          behavior: { type: "mode", mode: "click-create" },
        });
      });

      theme.hooks.change.tap(() => {
        syncThemeTextNodes();
      });

      ctx.hooks.pointerUp.tap(() => {
        if (selection.mode !== CanvasMode.CLICK_CREATE) {
          return;
        }

        if (tool.activeToolId !== "text") {
          return;
        }

        const pointer = scene.staticForegroundLayer.getRelativePointerPosition();
        if (!pointer) {
          return;
        }

        const timestamp = now();
        const el = fxApplyRememberedTextToolStyle({
          element: fnCreateTextElement({
            id: createId(),
            x: pointer.x,
            y: pointer.y,
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
          rememberedStyle: {
            strokeColor: DEFAULT_TEXT_COLOR_TOKEN,
            opacity: 1,
            fontFamily: `${DEFAULT_TEXT_FONT_FAMILY}, sans-serif`,
            fontSize: DEFAULT_TEXT_FONT_SIZE_TOKEN,
            textAlign: DEFAULT_TEXT_ALIGN,
            verticalAlign: DEFAULT_TEXT_VERTICAL_ALIGN,
            ...theme.getRememberedStyle("text"),
          },
        });
        const node = element.createNodeFromElement(el);
        if (!isKonvaText(node)) {
          return;
        }

        scene.staticForegroundLayer.add(node);
        renderOrder.assignOrderOnInsert({
          parent: scene.staticForegroundLayer,
          nodes: [node],
          position: "front",
        });
        scene.staticForegroundLayer.batchDraw();
        selection.setSelection([node]);
        selection.setFocusedNode(node);
        tool.setActiveTool("select");

        txEnterEditMode({
          Konva,
          camera,
          element,
          session,
          crdt,
          document,
          history,
          scene,
          selection,
          theme,
          pretext: { layoutWithLines, prepareWithSegments },
        }, {
          freeTextName: FREE_TEXT_NAME,
          node,
          isNew: true,
        });
      });

      ctx.hooks.elementPointerDoubleClick.tap((event) => {
        if (!isKonvaText(event.currentTarget)) {
          return false;
        }

        if (event.currentTarget.name() !== FREE_TEXT_NAME) {
          return false;
        }

        txEnterEditMode({
          Konva,
          camera,
          element,
          session,
          crdt,
          document,
          history,
          scene,
          selection,
          theme,
          pretext: { layoutWithLines, prepareWithSegments },
        }, {
          freeTextName: FREE_TEXT_NAME,
          node: event.currentTarget,
          isNew: false,
        });
        return true;
      });

      ctx.hooks.destroy.tap(() => {
        contextMenu.unregisterProvider("text");
        unregisterTextElement();
        tool.unregisterTool("text");
      });
    },
  };
}
