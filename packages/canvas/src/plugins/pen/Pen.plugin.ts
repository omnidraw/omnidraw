import { throttle } from "@solid-primitives/scheduled";
import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { resolveThemeColor, type ThemeService, type TThemeRememberedStyle } from "@vibecanvas/service-theme";
import Konva from "konva";
import Pencil from "lucide-static/icons/pencil.svg?raw";
import { getStroke } from "perfect-freehand";
import { PEN_STROKE_WIDTHS } from "../../components/SelectionStyleMenu/types";
import { isKonvaPath } from "../../core/GUARDS";
import { txFinalizeOwnedTransform } from "../../core/tx.finalize-owned-transform";
import type {
  CrdtService,
  GroupService,
  HistoryService,
  SceneService,
  TElementTransformAnchor,
  TToolCanvasPoint
} from "../../services";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices, TElementPointerEvent } from "../../types";
import { DEFAULT_OPACITY, DEFAULT_STROKE_WIDTH_TOKEN } from "./CONSTANTS";
import { fnCreatePenDataFromStrokePoints } from "./fn.math";
import { fxCreatePenNode } from "./fx.create-node";
import { fxPenPathToElement } from "./fx.path";
import { txCreatePenCloneDrag } from "./tx.clone";
import { txUpdatePenPathFromElement } from "./tx.path";

const DEFAULT_PEN_COLOR_TOKEN = "@base/900";
const DRAFT_POINTS_ATTR = "vcDraftStrokePoints";
const PEN_NODE_SETUP_ATTR = "vcPenNodeSetup";
const PEN_MOVE_BEFORE_ELEMENT_ATTR = "vcPenMoveBeforeElement";
const TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR = "vcTransformMoveBeforeElement";
const TRANSFORM_BEFORE_ELEMENT_ATTR = "vcTransformBeforeElement";
const MOVE_PATCH_INTERVAL_MS = 100;
const PEN_TRANSFORM_ANCHORS: TElementTransformAnchor[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

function fxCreatePenElementFromDraft(args: {
  id: string;
  now: number;
  points: TToolCanvasPoint[];
  rememberedStyle?: Pick<TThemeRememberedStyle, "strokeColor" | "strokeWidth" | "opacity">;
}): TElement {
  const penData = fnCreatePenDataFromStrokePoints({ points: args.points });
  if (!penData) {
    throw new Error("Failed to create pen draft data");
  }

  return {
    id: args.id,
    x: penData.x,
    y: penData.y,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: "",
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: args.now,
    updatedAt: args.now,
    data: penData,
    style: {
      backgroundColor: args.rememberedStyle?.strokeColor ?? DEFAULT_PEN_COLOR_TOKEN,
      opacity: args.rememberedStyle?.opacity ?? DEFAULT_OPACITY,
      strokeWidth: args.rememberedStyle?.strokeWidth ?? DEFAULT_STROKE_WIDTH_TOKEN,
    },
  };
}

function fxToPenElement(group: GroupService, now: () => number, node: Konva.Node) {
  if (!isKonvaPath(node)) {
    return null;
  }

  return fxPenPathToElement({
    editor: { toGroup: (candidate) => group.toGroup(candidate) },
    now,
  }, {
    node,
  });
}

function fxCreatePenRuntimeNode(theme: ThemeService, element: TElement) {
  return fxCreatePenNode({
    Path: Konva.Path,
    theme,
    getStroke,
    resolveThemeColor,
  }, {
    element,
  });
}

function fxStartPenDraftNode(args: {
  theme: ThemeService;
  now: () => number;
  point: TToolCanvasPoint;
  rememberedStyle?: Pick<TThemeRememberedStyle, "strokeColor" | "strokeWidth" | "opacity">;
}) {
  const node = fxCreatePenRuntimeNode(args.theme, fxCreatePenElementFromDraft({
    id: "pen-draft",
    now: args.now(),
    points: [args.point],
    rememberedStyle: args.rememberedStyle,
  }));

  if (!node) {
    throw new Error("Failed to create pen node");
  }

  node.setAttr(DRAFT_POINTS_ATTR, [args.point]);
  node.listening(false);
  node.draggable(false);
  return node;
}

function txUpdatePenDraftNode(args: {
  render: SceneService;
  theme: ThemeService;
  previewNode: Konva.Path;
  point: TToolCanvasPoint;
  now: number;
  rememberedStyle?: Pick<TThemeRememberedStyle, "strokeColor" | "strokeWidth" | "opacity">;
}) {
  const points = [
    ...((args.previewNode.getAttr(DRAFT_POINTS_ATTR) as TToolCanvasPoint[] | undefined) ?? []),
    args.point,
  ];
  args.previewNode.setAttr(DRAFT_POINTS_ATTR, points);

  txUpdatePenPathFromElement({
    Path: Konva.Path,
    render: args.render,
    theme: args.theme,
    getStroke,
    resolveThemeColor,
  }, {
    node: args.previewNode,
    element: fxCreatePenElementFromDraft({
      id: args.previewNode.id(),
      now: args.now,
      points,
      rememberedStyle: args.rememberedStyle,
    }),
  });
  args.previewNode.listening(false);
  args.previewNode.draggable(false);
}

function txUpdatePenDraft(args: {
  render: SceneService;
  theme: ThemeService;
  previewNode: Konva.Node;
  point: TToolCanvasPoint;
  now: number;
  rememberedStyle?: Pick<TThemeRememberedStyle, "strokeColor" | "strokeWidth" | "opacity">;
}) {
  if (!isKonvaPath(args.previewNode)) {
    return;
  }

  txUpdatePenDraftNode({
    render: args.render,
    theme: args.theme,
    previewNode: args.previewNode,
    point: args.point,
    now: args.now,
    rememberedStyle: args.rememberedStyle,
  });
}

function txSetupPenSelectionNode(args: {
  hooks: IRuntimeHooks;
  node: Konva.Node;
}) {
  if (!isKonvaPath(args.node)) {
    return false;
  }

  if (args.node.getAttr(PEN_NODE_SETUP_ATTR) === true) {
    args.node.off("pointerdown pointerdblclick dragstart dragmove dragend");
  }

  args.node.setAttr(PEN_NODE_SETUP_ATTR, true);

  args.node.on("pointerdown", (event) => {
    const didHandle = args.hooks.elementPointerDown.call(event as TElementPointerEvent);
    if (didHandle) {
      event.cancelBubble = true;
    }
  });

  args.node.on("pointerdblclick", (event) => {
    const didHandle = args.hooks.elementPointerDoubleClick.call(event as TElementPointerEvent);
    if (didHandle) {
      event.cancelBubble = true;
    }
  });

  return true;
}

function createCreateId(render: SceneService) {
  let fallbackId = 0;

  return () => {
    const cryptoApi = render.container.ownerDocument.defaultView?.crypto;
    if (cryptoApi?.randomUUID) {
      return cryptoApi.randomUUID();
    }

    fallbackId += 1;
    return `pen-${Date.now()}-${fallbackId}`;
  };
}

function txKeepPenTransformRatio(args: {
  node: Konva.Node;
}) {
  if (!isKonvaPath(args.node)) {
    return false;
  }

  const nextScale = Math.max(
    Math.abs(args.node.scaleX()),
    Math.abs(args.node.scaleY()),
    0.0001,
  );

  args.node.scale({ x: nextScale, y: nextScale });
  return true;
}

function txCommitPenTransform(args: {
  crdt: CrdtService;
  history: HistoryService;
  now: () => number;
  node: Konva.Node;
  label: string;
  applyElement: (element: TElement) => void;
  toElement: (node: Konva.Path) => TElement;
  render: SceneService;
  theme: ThemeService;
}) {
  if (!isKonvaPath(args.node)) {
    return false;
  }

  return txFinalizeOwnedTransform({
    crdt: args.crdt,
    history: args.history,
    applyElement: args.applyElement,
    serializeAfterElement: (candidateNode) => {
      if (!isKonvaPath(candidateNode)) {
        return null;
      }

      const element = args.toElement(candidateNode);
      txUpdatePenPathFromElement({
        Path: Konva.Path,
        render: args.render,
        theme: args.theme,
        getStroke,
        resolveThemeColor,
      }, {
        node: candidateNode,
        element,
      });

      return args.toElement(candidateNode);
    },
  }, {
    node: args.node,
    label: args.label,
    beforeAttr: TRANSFORM_BEFORE_ELEMENT_ATTR,
  });
}

/**
 * Owns pen draw-create flow, pen node hydration, drag, and clone wiring.
 * Keeps pen tool state in EditorService and scene behavior in SelectionService.
 */
export function createPenPlugin(): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "pen",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const tool = ctx.services.require("tool");
      const history = ctx.services.require("history");
      const render = ctx.services.require("scene");
      const renderOrder = ctx.services.require("renderOrder");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");
      const group = ctx.services.require("group");

      const now = () => Date.now();
      const createId = createCreateId(render);

      const moveSessions = new Map<string, {
        beforeElement: TElement;
        throttledPatch: (element: TElement) => void;
      }>();

      const toElement = (node: Konva.Path) => {
        const element = fxToPenElement(group, now, node);
        if (!element) {
          throw new Error("Failed to serialize pen node");
        }

        return element;
      };

      const applyElement = (el: TElement) => {
        element.updateElement(el);
        render.staticForegroundLayer.batchDraw();
      };

      const updateNodeFromElement = (element: TElement) => {
        const node = render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
          return isKonvaPath(candidate) && candidate.id() === element.id;
        });
        if (!isKonvaPath(node)) {
          return false;
        }

        txUpdatePenPathFromElement({
          Path: Konva.Path,
          render,
          theme,
          getStroke,
          resolveThemeColor,
        }, {
          node,
          element,
        });
        return true;
      };

      const txBeginPenMove = (node: Konva.Path, beforeElement?: TElement | null) => {
        const resolvedBeforeElement = beforeElement ? structuredClone(beforeElement) : structuredClone(toElement(node));
        node.setAttr(PEN_MOVE_BEFORE_ELEMENT_ATTR, structuredClone(resolvedBeforeElement));
        moveSessions.set(node.id(), {
          beforeElement: resolvedBeforeElement,
          throttledPatch: throttle((element: TElement) => {
            const builder = crdt.build();
            builder.patchElement(element.id, "x", element.x);
            builder.patchElement(element.id, "y", element.y);
            builder.patchElement(element.id, "updatedAt", element.updatedAt);
            builder.commit();
          }, MOVE_PATCH_INTERVAL_MS),
        });
      };

      const txEnsurePenMove = (node: Konva.Path) => {
        const existingSession = moveSessions.get(node.id());
        if (existingSession) {
          return existingSession;
        }

        const beforeElement = node.getAttr(PEN_MOVE_BEFORE_ELEMENT_ATTR) as TElement | undefined;
        const transformBeforeElement = node.getAttr(TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR) as TElement | undefined;
        txBeginPenMove(node, beforeElement ?? transformBeforeElement ?? null);
        return moveSessions.get(node.id()) ?? null;
      };

      const txPatchPenMove = (node: Konva.Path) => {
        const session = txEnsurePenMove(node);
        if (!session) {
          return false;
        }

        session.throttledPatch(toElement(node));
        return true;
      };

      const txFinalizePenMove = (node: Konva.Path) => {
        const session = moveSessions.get(node.id());
        moveSessions.delete(node.id());
        node.setAttr(PEN_MOVE_BEFORE_ELEMENT_ATTR, undefined);
        if (!session) {
          return false;
        }

        const beforeElement = structuredClone(session.beforeElement);
        const afterElement = structuredClone(toElement(node));
        const moveBuilder = crdt.build();
        moveBuilder.patchElement(afterElement.id, afterElement);
        const moveCommitResult = moveBuilder.commit();

        const didMove = beforeElement.x !== afterElement.x || beforeElement.y !== afterElement.y;
        if (!didMove) {
          return true;
        }

        history.record({
          label: "drag-pen",
          undo: () => {
            applyElement(beforeElement);
            moveCommitResult.rollback();
          },
          redo: () => {
            applyElement(afterElement);
            crdt.applyOps({ ops: moveCommitResult.redoOps });
          },
        });

        return true;
      };

      const setupNode = (node: Konva.Path) => {
        txSetupPenSelectionNode({ hooks: ctx.hooks, node });
        node.off("dragstart dragmove dragend");
        node.on("dragstart", (event) => {
          if (selection.mode !== "select") {
            try {
              if (node.isDragging()) {
                node.stopDrag();
              }
            } catch {
              return;
            }
            return;
          }

          if (event.evt?.altKey) {
            try {
              if (node.isDragging()) {
                node.stopDrag();
              }
            } catch {
              return;
            }
            txCreatePenCloneDrag({
              Path: Konva.Path,
              crdt,
              render,
              renderOrder,
              selection,
              theme,
              createId,
              now,
              getStroke,
              resolveThemeColor,
              setupNode,
              toElement,
            }, { node });
            return;
          }

          txBeginPenMove(node);
        });
        node.on("dragmove", () => {
          txPatchPenMove(node);
        });
        node.on("dragend", () => {
          txFinalizePenMove(node);
        });
        node.setDraggable(true);
        node.listening(true);
        node.visible(true);
        return node;
      };

      element.registerElement({
        id: "pen",
        matchesElement: (element) => element.data.type === "pen",
        matchesNode: (node) => isKonvaPath(node),
        toElement: (node) => fxToPenElement(group, now, node),
        createNode: (element) => fxCreatePenRuntimeNode(theme, element),
        attachListeners: (node) => {
          if (!isKonvaPath(node)) {
            return false;
          }

          setupNode(node);
          return true;
        },
        updateElement: (element) => {
          if (element.data.type !== "pen") {
            return false;
          }

          return updateNodeFromElement(element);
        },
        createDragClone: ({ node }) => {
          if (!isKonvaPath(node)) {
            return false;
          }

          txCreatePenCloneDrag({
            Path: Konva.Path,
            crdt,
            render,
            renderOrder,
            selection,
            theme,
            createId,
            now,
            getStroke,
            resolveThemeColor,
            setupNode,
            toElement,
          }, { node });
          return true;
        },
        getSelectionStyleMenu: () => ({
          sections: {
            showStrokeColorPicker: true,
            showStrokeWidthPicker: true,
            showOpacityPicker: true,
          },
          values: {
            strokeColor: DEFAULT_PEN_COLOR_TOKEN,
            strokeWidth: DEFAULT_STROKE_WIDTH_TOKEN,
            opacity: DEFAULT_OPACITY,
          },
          strokeWidthOptions: [...PEN_STROKE_WIDTHS],
        }),
        getTransformOptions: () => ({
          enabledAnchors: [...PEN_TRANSFORM_ANCHORS],
          keepRatio: true,
          flipEnabled: false,
        }),
        onMove: ({ node }) => {
          if (!isKonvaPath(node)) {
            return {
              cancel: false,
              crdt: false,
            };
          }

          txEnsurePenMove(node);
          txPatchPenMove(node);
          return {
            cancel: true,
            crdt: false,
          };
        },
        afterMove: ({ node }) => {
          if (!isKonvaPath(node)) {
            return {
              cancel: false,
              crdt: false,
            };
          }

          txFinalizePenMove(node);
          return {
            cancel: true,
            crdt: false,
          };
        },
        onResize: ({ node }) => {
          txKeepPenTransformRatio({ node });
          return {
            cancel: false,
            crdt: false,
          };
        },
        afterResize: ({ node }) => ({
          cancel: txCommitPenTransform({
            crdt,
            history,
            now,
            node,
            label: "transform-pen",
            applyElement,
            toElement,
            render,
            theme,
          }),
          crdt: false,
        }),
        afterRotate: ({ node }) => ({
          cancel: txCommitPenTransform({
            crdt,
            history,
            now,
            node,
            label: "rotate-pen",
            applyElement,
            toElement,
            render,
            theme,
          }),
          crdt: false,
        }),
      });

      theme.hooks.change.tap(() => {
        render.staticForegroundLayer.find((candidate: Konva.Node) => {
          return isKonvaPath(candidate);
        }).forEach((candidate) => {
          if (!isKonvaPath(candidate)) {
            return;
          }

          const element = fxToPenElement(group, now, candidate);
          if (!element || element.data.type !== "pen") {
            return;
          }

          updateNodeFromElement(element);
        });
        render.staticForegroundLayer.batchDraw();
      });

      ctx.hooks.init.tap(() => {
        tool.registerTool({
          id: "pen",
          label: "Pen",
          icon: Pencil,
          behavior: { type: "mode", mode: "draw-create" },
          shortcuts: ["p"],
          drawCreate: {
            startDraft: (args) => fxStartPenDraftNode({
              theme,
              now,
              point: args.point,
              rememberedStyle: theme.getRememberedStyle("pen"),
            }),
            updateDraft: (previewNode, args) => txUpdatePenDraft({
              render,
              theme,
              previewNode,
              point: args.point,
              now: args.now,
              rememberedStyle: theme.getRememberedStyle("pen"),
            }),
          },
        });
      });

      ctx.hooks.destroy.tap(() => {
        tool.unregisterTool("pen")
      });

    },
  };
}
