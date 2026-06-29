/* eslint-disable functional-core/import-boundary -- legacy tx setup function imports service classes as runtime-capable portal types */
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { fnGetCanvasAncestorGroups } from "../../core/fn.canvas-node-semantics";
import { CrdtService, ElementService, HistoryService, SceneService, SelectionService } from "../../services";
import type { IRuntimeHooks, TElementPointerEvent } from "../../types";
import type { TPortalUpdateImageNodeFromElement } from "./tx.update-image-node-from-element";
import { txUpdateImageNodeFromElement } from "./tx.update-image-node-from-element";

export type TPortalSetupImageListeners = {
  elementService: ElementService;
  crdt: CrdtService;
  history: HistoryService;
  render: SceneService;
  selection: SelectionService;
  hooks: IRuntimeHooks;
  startDragClone: (args: {
    node: Konva.Node;
    selection: Konva.Node[];
  }) => boolean;
  applyElement: (element: TElement) => void;
  updateImageNodeFromElementPortal: TPortalUpdateImageNodeFromElement;
  filterSelection: (selection: Konva.Node[]) => Konva.Node[];
  safeStopDrag: (node: Konva.Node) => void;
  toElement: (node: Konva.Image) => TElement;
  createThrottledPatch: () => (element: TElement) => void;
};

export type TArgsSetupImageListeners = {
  node: Konva.Image;
};

export function txSetupImageListeners(
  portal: TPortalSetupImageListeners,
  args: TArgsSetupImageListeners,
) {
  let originalElement: TElement | null = null;
  let isCloneDrag = false;
  const multiDragStartPositions = new Map<string, { x: number; y: number }>();
  const passengerOriginalElements = new Map<string, TElement[]>();

  const applyElement = (element: TElement) => {
    txUpdateImageNodeFromElement(portal.updateImageNodeFromElementPortal, {
      node: args.node,
      element,
    });

    fnGetCanvasAncestorGroups(args.node).forEach((group) => {
      group.fire("transform");
    });
  };

  const throttledPatch = portal.createThrottledPatch();

  args.node.off("pointerclick pointerdown dragstart pointerdblclick dragmove dragend");

  args.node.on("pointerclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    portal.hooks.elementPointerClick.call(event as TElementPointerEvent);
  });

  args.node.on("pointerdown dragstart", (event) => {
    if (portal.selection.mode !== "select") {
      portal.safeStopDrag(args.node);
      return;
    }

    if (event.type === "pointerdown") {
      const earlyExit = portal.hooks.elementPointerDown.call(event as TElementPointerEvent);
      if (earlyExit) {
        event.cancelBubble = true;
      }
    }

    if (event.type === "dragstart" && event.evt.altKey) {
      isCloneDrag = true;
      portal.safeStopDrag(args.node);
      portal.startDragClone({
        node: args.node,
        selection: portal.selection.selection,
      });
    }
  });

  args.node.on("pointerdblclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    const earlyExit = portal.hooks.elementPointerDoubleClick.call(event as TElementPointerEvent);
    if (earlyExit) {
      event.cancelBubble = true;
    }
  });

  args.node.on("dragstart", () => {
    if (isCloneDrag) {
      return;
    }

    originalElement = portal.toElement(args.node);
    multiDragStartPositions.clear();
    passengerOriginalElements.clear();

    const selected = portal.filterSelection(portal.selection.selection);
    selected.forEach((selectedNode) => {
      multiDragStartPositions.set(selectedNode.id(), { ...selectedNode.absolutePosition() });
      if (selectedNode === args.node) {
        return;
      }

      const element = portal.elementService.toElement(selectedNode);
      if (element) {
        passengerOriginalElements.set(selectedNode.id(), [structuredClone(element)]);
      }
    });
  });

  args.node.on("dragmove", () => {
    if (isCloneDrag) {
      return;
    }

    throttledPatch(portal.toElement(args.node));

    const selected = portal.filterSelection(portal.selection.selection);
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

    const nextElement = portal.toElement(args.node);
    const beforeElement = originalElement ? structuredClone(originalElement) : null;
    const afterElement = structuredClone(nextElement);

    const selected = portal.filterSelection(portal.selection.selection);
    const passengers = selected.filter((selectedNode) => selectedNode !== args.node);
    const passengerAfterElements = new Map<string, TElement[]>();

    passengers.forEach((passenger) => {
      const element = portal.elementService.toElement(passenger);
      if (!element) {
        return;
      }

      passengerAfterElements.set(passenger.id(), [structuredClone(element)]);
    });

    const dragBuilder = portal.crdt.build();
    dragBuilder.patchElement(afterElement.id, afterElement);
    passengerAfterElements.forEach((elements) => {
      elements.forEach((element) => {
        dragBuilder.patchElement(element.id, element);
      });
    });
    const dragCommitResult = dragBuilder.commit();

    const capturedStartPositions = new Map(multiDragStartPositions);
    const capturedPassengerOriginals = new Map(passengerOriginalElements);
    multiDragStartPositions.clear();
    originalElement = null;

    if (!beforeElement) {
      return;
    }

    const didMove = beforeElement.x !== afterElement.x || beforeElement.y !== afterElement.y;
    if (!didMove) {
      return;
    }

    portal.history.record({
      label: "drag-image",
      undo() {
        applyElement(beforeElement);
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
            portal.applyElement(element);
          });
        });
        dragCommitResult.rollback();
      },
      redo() {
        applyElement(afterElement);
        passengers.forEach((passenger) => {
          const afterEls = passengerAfterElements.get(passenger.id());
          if (!afterEls || afterEls.length === 0) {
            return;
          }

          afterEls.forEach((element) => {
            portal.applyElement(element);
          });
        });
        portal.crdt.applyOps({ ops: dragCommitResult.redoOps });
      },
    });
  });
}
