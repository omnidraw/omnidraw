import type { IPlugin } from "@vibecanvas/runtime";
import type { ThemeService } from "@vibecanvas/service-theme";
import Konva from "konva";
import type { Group } from "konva/lib/Group";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { throttle } from "@solid-primitives/scheduled";
import type { ElementService, GroupService, SessionService, CanvasRegistryService, TCanvasTransformAnchor } from "../../services";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeHooks } from "../../types";
import { fnIsCanvasGroupNode } from "../../core/fn.canvas-node-semantics";
import { fxGetProxyDragTarget } from "./fx.proxy-drag-target";
import { fxGetProxyBounds } from "./fx.proxy-bounds";
import { txDispatchSelectionTransformHooks } from "./tx.dispatch-selection-transform-hooks";
import { txSyncTransformer } from "./tx.sync-transformer";

const TRANSFORM_DRAG_PROXY_NAME = "transform-drag-proxy";
const INTERACTION_OVERLAY_ATTR = "vcInteractionOverlay";
const TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR = "vcTransformMoveBeforeElement";
const TRANSFORM_BEFORE_ELEMENT_ATTR = "vcTransformBeforeElement";
const MOVE_PATCH_INTERVAL_MS = 1000 / 30;

type TTransformDragProxyState = {
  node: Shape<ShapeConfig>;
  beforeElement: TElement;
  label: string;
  proxyStartPosition: { x: number; y: number };
  nodeStartPosition: { x: number; y: number };
  throttledPatch: (element: TElement) => void;
};

/**
 * Expands a runtime selection into nodes that can round-trip through the canvas registry.
 * Element-groups are treated as serializable roots, while structural groups recurse into children.
 */
function collectSerializableNodes(
  elementSrv: ElementService,
  nodes: Konva.Node[],
): Array<Group | Shape<ShapeConfig>> {
  return nodes.flatMap((node) => {
    if (node instanceof Konva.Group) {
      return elementSrv.toElement(node) ? [node] : collectSerializableNodes(elementSrv  , node.getChildren());
    }

    if (node instanceof Konva.Shape) {
      return [node];
    }

    return [];
  });
}

/**
 * Serializes the current runtime nodes into persisted canvas elements.
 * Used for transform snapshots and history capture.
 */
function serializeSelection(elementSrv: ElementService, nodes: Konva.Node[]) {
  const serializableNodes = collectSerializableNodes(elementSrv, nodes);
  return serializableNodes
    .map((node) => elementSrv.toElement(node))
    .filter((element): element is TElement => element !== null);
}

/**
 * Replays persisted elements back onto the existing runtime scene.
 */
function applyElements(elementSrv: ElementService, elements: TElement[]) {
  elements.forEach((element) => {
    elementSrv.updateElement(element);
  });
}

/**
 * Clears transient Konva transform state on structural groups after a transform commit.
 * Persisted children carry the real geometry, so group container transforms must be reset.
 */
function normalizeSelectedGroupTransforms(nodes: Konva.Node[]) {
  nodes.forEach((node) => {
    if (!(node instanceof Konva.Group)) {
      return;
    }

    node.scale({ x: 1, y: 1 });
    node.rotation(0);
    node.skew({ x: 0, y: 0 });
  });
}

/**
 * Re-emits transform on selected structural groups so plugins can refresh derived visuals.
 */
function refreshSelectedGroups(selection: SelectionService) {
  selection.selection.forEach((node) => {
    if (fnIsCanvasGroupNode(node)) {
      node.fire("transform");
    }
  });
}

/**
 * Returns transformer-local pointer position from the dynamic layer.
 */
function getTransformerPointer(scene: SceneService) {
  return scene.dynamicLayer.getRelativePointerPosition();
}

/**
 * Narrows Konva transformer anchor names into the typed registry anchor union.
 */
function isTypedAnchor(anchor: string | null): anchor is TCanvasTransformAnchor {
  return anchor === "top-left"
    || anchor === "top-center"
    || anchor === "top-right"
    || anchor === "middle-left"
    || anchor === "middle-right"
    || anchor === "bottom-left"
    || anchor === "bottom-center"
    || anchor === "bottom-right";
}

/**
 * Dispatches resize-finalization callbacks after the interactive transformer gesture ends.
 */
function txApplySelectionResizeHooks(args: {
  element: ElementService;
  scene: SceneService;
  selection: Array<Group | Shape<ShapeConfig>>;
  anchors: TCanvasTransformAnchor[];
}) {
  const pointer = getTransformerPointer(args.scene);

  return txDispatchSelectionTransformHooks({
    element: args.element,
  }, {
    selection: args.selection,
    createArgs: (node, element) => ({
      node,
      element,
      pointer,
      anchors: args.anchors,
      selection: args.selection,
    }),
    getHook: (definition) => definition.onResize,
  });
}

function txApplySelectionRotateHooks(args: {
  element: ElementService;
  selection: Array<Group | Shape<ShapeConfig>>;
}) {
  return txDispatchSelectionTransformHooks({
    element: args.element,
  }, {
    selection: args.selection,
    createArgs: (node, element) => ({
      node,
      element,
      rotation: node.rotation(),
      selection: args.selection,
    }),
    getHook: (definition) => definition.onRotate,
  });
}

/**
 * Dispatches resize-finalization callbacks after the interactive transformer gesture ends.
 */
function txFinalizeSelectionResize(args: {
  element: ElementService;
  scene: SceneService;
  selection: Array<Group | Shape<ShapeConfig>>;
  anchors: TCanvasTransformAnchor[];
}) {
  const pointer = getTransformerPointer(args.scene);

  return txDispatchSelectionTransformHooks({
    element: args.element,
  }, {
    selection: args.selection,
    createArgs: (node, element) => ({
      node,
      element,
      pointer,
      anchors: args.anchors,
      selection: args.selection,
    }),
    getHook: (definition) => definition.afterResize,
  });
}

function txFinalizeSelectionRotate(args: {
  element: ElementService;
  selection: Array<Group | Shape<ShapeConfig>>;
}) {
  return txDispatchSelectionTransformHooks({
    element: args.element,
  }, {
    selection: args.selection,
    createArgs: (node, element) => ({
      node,
      element,
      rotation: node.rotation(),
      selection: args.selection,
    }),
    getHook: (definition) => definition.afterRotate,
  });
}

/**
 * Produces the history label for drag-proxy move operations.
 */
function getProxyDragLabel(element: TElement) {
  return element.data.type === "pen" ? "drag-pen" : "drag-shape1d";
}

/**
 * Applies current theme colors to the shared Konva transformer instance.
 */
function syncTransformerTheme(theme: ThemeService, transformer: Konva.Transformer) {
  const activeTheme = theme.getTheme();
  transformer.borderStroke(activeTheme.colors.canvasSelectionStroke);
  transformer.anchorStroke(activeTheme.colors.canvasSelectionStroke);
  transformer.anchorFill(activeTheme.colors.background);
  transformer.anchorCornerRadius(0);
  transformer.anchorSize(8);
}

/**
 * Owns shared transform UX for existing scene nodes.
 *
 * Responsibilities:
 * - keep one shared Konva.Transformer in sync with filtered selection
 * - provide a drag proxy for single pen/shape1d selections
 * - route semantic move/resize callbacks through CanvasRegistryService
 * - keep generic transform persistence as fallback when plugins do not own it
 *
 * Design notes:
 * - move persistence belongs to element plugins when they opt into callbacks
 * - resize/rotate fallback still lives here for element types that have not claimed ownership yet
 * - drag proxy stays behind the visual node so direct pointer targeting still works
 */
export function createTransformPlugin(): IPlugin<{
  element: ElementService;
  group: GroupService;
  session: SessionService;
  crdt: CrdtService;
  history: HistoryService;
  scene: SceneService;
  selection: SelectionService;
  theme: ThemeService;
}, IRuntimeHooks> {
  let transformer: Konva.Transformer | null = null;
  let dragProxy: Konva.Rect | null = null;
  let dragProxyState: TTransformDragProxyState | null = null;
  let beforeElements: TElement[] = [];

  return {
    name: "transform",
    apply(ctx) {
      const element = ctx.services.require("element");
      const group = ctx.services.require("group");
      const session = ctx.services.require("session");
      const crdt = ctx.services.require("crdt");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const theme = ctx.services.require("theme");

      const refreshTransformer = () => {
        if (!transformer) {
          return;
        }

        txSyncTransformer({
          Konva,
          scene,
          element,
          session,
          selection,
          transformer,
        }, {});
      };

      const hideDragProxy = () => {
        if (!dragProxy) {
          return;
        }

        dragProxy.visible(false);
        dragProxy.listening(false);
        dragProxy.draggable(false);
        scene.staticForegroundLayer.batchDraw();
      };

      const txEnsureDragProxyAttached = () => {
        if (!dragProxy) {
          return null;
        }

        if (dragProxy.getParent() !== scene.staticForegroundLayer) {
          scene.staticForegroundLayer.add(dragProxy);
        }

        return dragProxy;
      };

      const refreshDragProxy = () => {
        if (!dragProxy || dragProxyState) {
          return;
        }

        if (session.editingId !== null) {
          hideDragProxy();
          return;
        }

        const target = fxGetProxyDragTarget({ element, Konva }, { selection });
        if (!target) {
          hideDragProxy();
          return;
        }

        const attachedDragProxy = txEnsureDragProxyAttached();
        if (!attachedDragProxy) {
          return;
        }

        const bounds = fxGetProxyBounds({ scene }, { node: target });
        attachedDragProxy.position(bounds.position);
        attachedDragProxy.rotation(bounds.rotation);
        attachedDragProxy.scale({ x: 1, y: 1 });
        attachedDragProxy.size({ width: bounds.width, height: bounds.height });
        attachedDragProxy.visible(true);
        attachedDragProxy.listening(true);
        attachedDragProxy.draggable(true);
        const targetIndex = target.zIndex();
        const proxyIndex = attachedDragProxy.zIndex();
        attachedDragProxy.zIndex(proxyIndex < targetIndex ? Math.max(0, targetIndex - 1) : targetIndex);
        scene.staticForegroundLayer.batchDraw();
      };

      const applyProxyDragElement = (el: TElement) => {
        applyElements(element, [el]);
        refreshTransformer();
        scene.staticForegroundLayer.batchDraw();
      };

      ctx.hooks.init.tap(() => {
        dragProxy = new Konva.Rect({
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
          fill: theme.getTheme().colors.canvasSelectionFill,
          opacity: 0.01,
          strokeEnabled: false,
          visible: false,
          listening: false,
          draggable: false,
          name: TRANSFORM_DRAG_PROXY_NAME,
        });
        dragProxy.setAttr(INTERACTION_OVERLAY_ATTR, true);
        scene.staticForegroundLayer.add(dragProxy);

        dragProxy.on("dragstart", (event) => {
          if (!dragProxy) {
            return;
          }

          const target = fxGetProxyDragTarget({ element, Konva }, { selection });

          if (event.evt?.altKey) {
            dragProxy.stopDrag();
            dragProxy.absolutePosition(dragProxy.absolutePosition());
            if (target) {
              element.createDragClone({
                node: target,
                selection: selection.selection,
              });
            }
            refreshDragProxy();
            return;
          }

          if (!target) {
            dragProxy.stopDrag();
            hideDragProxy();
            return;
          }

          const beforeElement = element.toElement(target);
          if (!beforeElement) {
            dragProxy.stopDrag();
            refreshDragProxy();
            return;
          }

          target.setAttr(TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR, structuredClone(beforeElement));
          dragProxyState = {
            node: target,
            beforeElement,
            label: getProxyDragLabel(beforeElement),
            proxyStartPosition: { ...dragProxy.absolutePosition() },
            nodeStartPosition: { ...target.absolutePosition() },
            throttledPatch: throttle((element: TElement) => {
              const builder = crdt.build();
              builder.patchElement(element.id, "x", element.x);
              builder.patchElement(element.id, "y", element.y);
              builder.patchElement(element.id, "updatedAt", element.updatedAt);
              builder.commit();
            }, MOVE_PATCH_INTERVAL_MS),
          };
        });

        dragProxy.on("dragmove", () => {
          if (!dragProxy || !dragProxyState) {
            return;
          }

          const state = dragProxyState;
          const currentProxyPosition = dragProxy.absolutePosition();
          const dx = currentProxyPosition.x - state.proxyStartPosition.x;
          const dy = currentProxyPosition.y - state.proxyStartPosition.y;
          state.node.absolutePosition({
            x: state.nodeStartPosition.x + dx,
            y: state.nodeStartPosition.y + dy,
          });

          const el = element.toElement(state.node);
          if (el) {
            const moveResult = txDispatchSelectionTransformHooks({
              element,
            }, {
              selection: selection.selection,
              createArgs: () => ({
                node: state.node,
                element: el,
                pointer: scene.dynamicLayer.getRelativePointerPosition(),
                selection: selection.selection,
              }),
              getHook: (definition) => definition.onMove,
            });

            if (!moveResult.cancel) {
              const nextElement = element.toElement(state.node);
              if (nextElement) {
                state.throttledPatch(nextElement);
              }
            }
          }
          scene.staticForegroundLayer.batchDraw();
        });

        dragProxy.on("dragend", () => {
          if (!dragProxy || !dragProxyState) {
            refreshDragProxy();
            return;
          }

          const state = dragProxyState;
          dragProxyState = null;
          const afterElement = element.toElement(state.node);
          state.node.setAttr(TRANSFORM_MOVE_BEFORE_ELEMENT_ATTR, undefined);
          if (!afterElement) {
            refreshDragProxy();
            return;
          }

          const afterMoveResult = txDispatchSelectionTransformHooks({
            element,
          }, {
            selection: selection.selection,
            createArgs: () => ({
              node: state.node,
              element: afterElement,
              pointer: scene.dynamicLayer.getRelativePointerPosition(),
              selection: selection.selection,
            }),
            getHook: (definition) => definition.afterMove,
          });
          refreshDragProxy();

          if (afterMoveResult.cancel) {
            return;
          }

          const moveBuilder = crdt.build();
          moveBuilder.patchElement(afterElement.id, afterElement);
          const moveCommitResult = moveBuilder.commit();

          const didMove = state.beforeElement.x !== afterElement.x || state.beforeElement.y !== afterElement.y;
          if (!didMove) {
            return;
          }

          const undoElement = structuredClone(state.beforeElement);
          const redoElement = structuredClone(afterElement);
          history.record({
            label: state.label,
            undo: () => {
              applyProxyDragElement(undoElement);
              moveCommitResult.rollback();
              refreshDragProxy();
            },
            redo: () => {
              applyProxyDragElement(redoElement);
              crdt.applyOps({ ops: moveCommitResult.redoOps });
              refreshDragProxy();
            },
          });
        });

        transformer = new Konva.Transformer();
        syncTransformerTheme(theme, transformer);
        scene.dynamicLayer.add(transformer);

        transformer.on("transformstart", () => {
          const nodes = transformer?.getNodes() ?? [];
          beforeElements = serializeSelection(element, nodes);
          nodes.forEach((node) => {
            const beforeElement = element.toElement(node);
            if (!beforeElement) {
              return;
            }

            node.setAttr(TRANSFORM_BEFORE_ELEMENT_ATTR, structuredClone(beforeElement));
          });
        });

        transformer.on("transform", () => {
          if (!transformer) {
            return;
          }

          const activeAnchor = transformer.getActiveAnchor();
          const anchors = isTypedAnchor(activeAnchor) ? [activeAnchor] : [];
          const selectedNodes = transformer.getNodes() as Array<Group | Shape<ShapeConfig>>;
          if (activeAnchor === "rotater") {
            txApplySelectionRotateHooks({
              element,
              selection: selectedNodes,
            });
          } else {
            txApplySelectionResizeHooks({
              element,
              scene: scene,
              selection: selectedNodes,
              anchors,
            });
          }
          transformer.forceUpdate();
          scene.dynamicLayer.batchDraw();
          refreshDragProxy();
        });

        transformer.on("transformend", () => {
          if (!transformer) {
            return;
          }

          const nodes = transformer.getNodes();
          const activeAnchor = transformer.getActiveAnchor();
          const anchors = isTypedAnchor(activeAnchor) ? [activeAnchor] : [];
          const transformResult = activeAnchor === "rotater"
            ? txFinalizeSelectionRotate({
              element,
              selection: nodes as Array<Group | Shape<ShapeConfig>>,
            })
            : txFinalizeSelectionResize({
              element,
              scene: scene,
              selection: nodes as Array<Group | Shape<ShapeConfig>>,
              anchors,
            });

          const afterElements = serializeSelection(element, nodes);
          if (afterElements.length === 0) {
            return;
          }

          nodes.forEach((node) => {
            node.setAttr(TRANSFORM_BEFORE_ELEMENT_ATTR, undefined);
          });

          const fallbackBeforeElements = beforeElements.filter((element) => !transformResult.handledNodeIds.has(element.id));
          const fallbackAfterElements = afterElements.filter((element) => !transformResult.handledNodeIds.has(element.id));

          if (fallbackAfterElements.length === 0) {
            refreshSelectedGroups(selection);
            refreshTransformer();
            refreshDragProxy();
            return;
          }

          normalizeSelectedGroupTransforms(nodes);
          applyElements(element, fallbackAfterElements);
          refreshSelectedGroups(selection);
          refreshTransformer();
          refreshDragProxy();
          const transformBuilder = crdt.build();
          fallbackAfterElements.forEach((element) => {
            transformBuilder.patchElement(element.id, element);
          });
          const transformCommitResult = transformBuilder.commit();

          if (fallbackBeforeElements.length === 0) {
            return;
          }

          const undoElements = structuredClone(fallbackBeforeElements);
          const redoElements = structuredClone(fallbackAfterElements);

          history.record({
            label: "transform",
            undo: () => {
              applyElements(element, undoElements);
              refreshSelectedGroups(selection);
              refreshTransformer();
              refreshDragProxy();
              transformCommitResult.rollback();
            },
            redo: () => {
              applyElements(element, redoElements);
              refreshSelectedGroups(selection);
              refreshTransformer();
              refreshDragProxy();
              crdt.applyOps({ ops: transformCommitResult.redoOps });
            },
          });
        });

        refreshTransformer();
        refreshDragProxy();

        selection.hooks.change.tap(() => {
          refreshTransformer();
          refreshDragProxy();
        });
        session.hooks.editingChange.tap(() => {
          refreshTransformer();
          refreshDragProxy();
        });
        group.hooks.groupsChange.tap(() => {
          refreshTransformer();
          refreshDragProxy();
        });
        theme.hooks.change.tap(() => {
          if (transformer) {
            syncTransformerTheme(theme, transformer);
          }
          if (dragProxy) {
            dragProxy.fill(theme.getTheme().colors.canvasSelectionFill);
          }
          refreshTransformer();
          refreshDragProxy();
        });
      });

      ctx.hooks.pointerMove.tap((event) => {
        if (event.evt.buttons === 0) {
          return;
        }

        refreshDragProxy();
      });

      ctx.hooks.pointerUp.tap(() => {
        refreshDragProxy();
      });

      ctx.hooks.pointerCancel.tap(() => {
        dragProxyState = null;
        refreshDragProxy();
      });

      ctx.hooks.destroy.tap(() => {
        dragProxyState = null;
        dragProxy?.destroy();
        dragProxy = null;
        transformer?.destroy();
        transformer = null;
      });
    },
  };
}
