import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TThemeDefinition } from "@vibecanvas/service-theme";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { IRuntimeHooks, TElementPointerEvent } from "../../types";
import { fnGetCanvasAncestorGroups, fnGetCanvasNodeKind, fnIsCanvasGroupNode } from "../../core/fn.canvas-node-semantics";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import { fnSerializeSubtreeElements } from "../group/fn.serialize-subtree-elements";
import type { CanvasRegistryService } from "../../services/canvas-registry/CanvasRegistryService";
import { type TShape1dNode } from "./CONSTANTS";
import { fxToPositionPatch, fxToTElement } from "./fx.node";
import { txCreatePreviewClone } from "./tx.element";
import { txRecordCreateHistory, type TPortalTxRecordShape1dHistory } from "./tx.history";

export type TPortalTxSafeStopDrag = {};
export type TArgsTxSafeStopDrag = { node: Konva.Node };
export function txSafeStopDrag(portal: TPortalTxSafeStopDrag, args: TArgsTxSafeStopDrag) {
  void portal;
  try {
    if (args.node.isDragging()) {
      args.node.stopDrag();
    }
  } catch {
    return;
  }
}

export type TPortalTxShape1dRuntime = TPortalTxRecordShape1dHistory & {
  Konva: typeof Konva;
  hooks: IRuntimeHooks;
  theme: { getTheme(): string | TThemeDefinition };
  createId: () => string;
  now: () => number;
  createThrottledPatch: (callback: (patch: Pick<TElement, "id" | "x" | "y" | "parentGroupId" | "updatedAt">) => void) => (patch: Pick<TElement, "id" | "x" | "y" | "parentGroupId" | "updatedAt">) => void;
};
export type TArgsTxSetupShapeListeners = { node: TShape1dNode };

function findSceneNodeById(portal: TPortalTxShape1dRuntime, id: string) {
  const node = portal.render.staticForegroundLayer.findOne((candidate: Konva.Node) => {
    return (candidate instanceof portal.Konva.Group || candidate instanceof portal.Konva.Shape) && candidate.id() === id;
  });

  if (!(node instanceof portal.Konva.Group) && !(node instanceof portal.Konva.Shape)) {
    return null;
  }

  return node;
}

function applyElement(portal: TPortalTxShape1dRuntime, element: TElement) {
  const didUpdate = portal.canvasRegistry.updateElement(element);
  if (!didUpdate) {
    return;
  }

  const node = findSceneNodeById(portal, element.id);
  if (!node) {
    return;
  }

  fnGetCanvasAncestorGroups(node).forEach((group) => {
    group.fire("transform");
  });
}

function serializeNodeElements(portal: TPortalTxShape1dRuntime, node: Konva.Node) {
  const kind = fnGetCanvasNodeKind(node);
  if (kind === "element") {
    const element = portal.canvasRegistry.toElement(node);
    return element ? [structuredClone(element)] : [];
  }

  if (kind === "group" && fnIsCanvasGroupNode(node)) {
    return fnSerializeSubtreeElements({
      canvasRegistry: portal.canvasRegistry,
      Shape: portal.Konva.Shape,
      group: node as Konva.Group,
    }).map((element) => structuredClone(element));
  }

  return [] as TElement[];
}

export type TArgsTxFinalizePreviewClone = { previewClone: TShape1dNode };
export function txFinalizePreviewClone(portal: TPortalTxShape1dRuntime, args: TArgsTxFinalizePreviewClone) {
  if (args.previewClone.isDragging()) {
    args.previewClone.stopDrag();
  }

  args.previewClone.moveTo(portal.render.staticForegroundLayer);
  portal.setupNode(args.previewClone);
  args.previewClone.setDraggable(true);
  portal.renderOrder.assignOrderOnInsert({ parent: portal.render.staticForegroundLayer, nodes: [args.previewClone], position: "front" });

  const createdElement = fxToTElement({ editor: portal.canvasRegistry, now: portal.now }, { node: args.previewClone });
  txRecordCreateHistory(portal, { element: createdElement, node: args.previewClone, label: "clone-shape1d" });
  portal.render.dynamicLayer.batchDraw();
  portal.render.staticForegroundLayer.batchDraw();
  return args.previewClone;
}

export type TArgsTxCreateCloneDrag = { node: TShape1dNode };
export function txCreateCloneDrag(portal: TPortalTxShape1dRuntime, args: TArgsTxCreateCloneDrag) {
  const previewClone = txCreatePreviewClone({
    createId: portal.createId,
    now: portal.now,
    editor: portal.canvasRegistry,
    theme: portal.theme,
    resolveThemeColor: portal.resolveThemeColor,
    createShapeNode: portal.createShapeNode,
    setNodeZIndex: portal.setNodeZIndex,
  }, { node: args.node });
  portal.render.dynamicLayer.add(previewClone);
  previewClone.startDrag();

  const finalizeCloneDrag = () => {
    previewClone.off("dragend", finalizeCloneDrag);
    const cloned = txFinalizePreviewClone(portal, { previewClone });
    portal.selection.setSelection(cloned ? [cloned] : []);
    portal.selection.setFocusedNode(cloned);
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return previewClone;
}

export function txSetupShapeListeners(portal: TPortalTxShape1dRuntime, args: TArgsTxSetupShapeListeners) {
  if (args.node.getAttr("vcShape1dNodeSetup") === true) {
    args.node.off("pointerclick pointerdown dragstart pointerdblclick dragmove dragend");
  }

  args.node.setAttr("vcShape1dNodeSetup", true);
  let originalElement: TElement | null = null;
  let isCloneDrag = false;
  const multiDragStartPositions = new Map<string, { x: number; y: number }>();
  const passengerOriginalElements = new Map<string, TElement[]>();
  const throttledPatch = portal.createThrottledPatch((patch) => {
    const builder = portal.crdt.build();
    builder.patchElement(patch.id, "x", patch.x);
    builder.patchElement(patch.id, "y", patch.y);
    builder.patchElement(patch.id, "parentGroupId", patch.parentGroupId);
    builder.patchElement(patch.id, "updatedAt", patch.updatedAt);
    builder.commit();
  });

  args.node.on("pointerclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }
    portal.hooks.elementPointerClick.call(event as TElementPointerEvent);
  });

  args.node.on("pointerdown dragstart", (event) => {
    if (portal.selection.mode !== "select") {
      txSafeStopDrag({}, { node: args.node });
      return;
    }
    if (event.type === "pointerdown") {
      const earlyExit = portal.hooks.elementPointerDown.call(event as TElementPointerEvent);
      if (earlyExit) {
        event.cancelBubble = true;
      }
      return;
    }
    if (event.evt?.altKey) {
      isCloneDrag = true;
      txSafeStopDrag({}, { node: args.node });
      txCreateCloneDrag(portal, { node: args.node });
      return;
    }

    originalElement = fxToTElement({ editor: portal.canvasRegistry, now: portal.now }, { node: args.node });
    multiDragStartPositions.clear();
    passengerOriginalElements.clear();

    const selected = fnFilterSelection({ selection: portal.selection.selection });
    selected.forEach((selectedNode) => {
      multiDragStartPositions.set(selectedNode.id(), { ...selectedNode.absolutePosition() });
      if (selectedNode === args.node) {
        return;
      }
      const elements = serializeNodeElements(portal, selectedNode);
      if (elements.length > 0) {
        passengerOriginalElements.set(selectedNode.id(), elements);
      }
    });
  });

  args.node.on("pointerdblclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }
    if (portal.selection.selection.length === 0) {
      portal.selection.setSelection([args.node]);
      portal.selection.setFocusedNode(args.node);
    }
    const earlyExit = portal.hooks.elementPointerDoubleClick.call(event as TElementPointerEvent);
    if (earlyExit) {
      event.cancelBubble = true;
    }
  });

  args.node.on("dragmove", () => {
    if (isCloneDrag) {
      return;
    }
    throttledPatch(fxToPositionPatch({ editor: portal.canvasRegistry, now: portal.now }, { node: args.node }));
    const selected = fnFilterSelection({ selection: portal.selection.selection });
    if (selected.length <= 1) {
      return;
    }
    const start = multiDragStartPositions.get(args.node.id());
    if (!start) {
      return;
    }
    const current = args.node.absolutePosition();
    const dx = current.x - start.x;
    const dy = current.y - start.y;
    selected.forEach((other) => {
      if (other === args.node || other.isDragging()) {
        return;
      }
      const otherStart = multiDragStartPositions.get(other.id());
      if (!otherStart) {
        return;
      }
      other.absolutePosition({ x: otherStart.x + dx, y: otherStart.y + dy });
    });
  });

  args.node.on("dragend", () => {
    if (isCloneDrag) {
      isCloneDrag = false;
      originalElement = null;
      multiDragStartPositions.clear();
      passengerOriginalElements.clear();
      return;
    }

    const nextElement = fxToTElement({ editor: portal.canvasRegistry, now: portal.now }, { node: args.node });
    const beforeElement = originalElement ? structuredClone(originalElement) : null;
    const afterElement = structuredClone(nextElement);

    const selected = fnFilterSelection({ selection: portal.selection.selection });
    const passengers = selected.filter((selectedNode) => selectedNode !== args.node);
    const passengerAfterElements = new Map<string, TElement[]>();
    const passengerEndPositions = new Map<string, { x: number; y: number }>();
    passengers.forEach((passenger) => {
      passengerEndPositions.set(passenger.id(), { ...passenger.absolutePosition() });
      const elements = serializeNodeElements(portal, passenger);
      if (elements.length === 0) {
        return;
      }
      passengerAfterElements.set(passenger.id(), elements);
    });

    const dragCommitResult = (() => {
      const builder = portal.crdt.build();
      builder.patchElement(afterElement.id, afterElement);
      passengerAfterElements.forEach((elements) => {
        elements.forEach((element) => {
          builder.patchElement(element.id, element);
        });
      });
      return builder.commit();
    })();

    const capturedStartPositions = new Map(multiDragStartPositions);
    const capturedEndPositions = new Map(passengerEndPositions);
    const capturedPassengerOriginals = new Map(passengerOriginalElements);
    multiDragStartPositions.clear();
    passengerOriginalElements.clear();
    originalElement = null;
    if (!beforeElement) {
      return;
    }
    const didMove = beforeElement.x !== afterElement.x || beforeElement.y !== afterElement.y;
    if (!didMove) {
      return;
    }

    portal.history.record({
      label: "drag-shape1d",
      undo() {
        applyElement(portal, beforeElement);
        passengers.forEach((passenger) => {
          const startPos = capturedStartPositions.get(passenger.id());
          if (startPos) {
            passenger.absolutePosition(startPos);
          }
          const originalEls = capturedPassengerOriginals.get(passenger.id());
          if (!originalEls || originalEls.length === 0) {
            return;
          }
          originalEls.forEach((element) => {
            applyElement(portal, element);
          });
        });
        dragCommitResult.rollback();
      },
      redo() {
        applyElement(portal, afterElement);
        passengers.forEach((passenger) => {
          const endPos = capturedEndPositions.get(passenger.id());
          if (endPos) {
            passenger.absolutePosition(endPos);
          }
          const afterEls = passengerAfterElements.get(passenger.id());
          if (!afterEls || afterEls.length === 0) {
            return;
          }
          afterEls.forEach((element) => {
            applyElement(portal, element);
          });
        });
        portal.crdt.applyOps({ ops: dragCommitResult.redoOps });
      },
    });
  });
}
