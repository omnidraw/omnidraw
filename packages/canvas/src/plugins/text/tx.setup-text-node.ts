import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type { CrdtService, HistoryService, SceneService, SelectionService } from "../../services";
import type { IRuntimeHooks } from "../../types";
import { txUpdateTextNodeFromElement } from "./tx.update-text-node-from-element";

export type TPortalSetupTextNode = {
  Konva: typeof Konva;
  crdt: CrdtService;
  history: HistoryService;
  hooks: IRuntimeHooks;
  render: SceneService;
  selection: SelectionService;
  serializeNode: (args: { node: Konva.Text; createdAt: number; updatedAt: number }) => TElement;
  theme: ThemeService;
  now: () => number;
  startDragClone: (args: {
    node: Konva.Node;
    selection: Array<Konva.Node>;
  }) => boolean;
  createThrottledPatch: (callback: (element: TElement) => void) => (element: TElement) => void;
};

export type TArgsSetupTextNode = {
  freeTextName: string;
  node: Konva.Text;
};

function stopDragSafely(node: Konva.Node) {
  try {
    if (node.isDragging()) {
      node.stopDrag();
    }
  } catch {
    return;
  }
}

export function txSetupTextNode(portal: TPortalSetupTextNode, args: TArgsSetupTextNode) {
  let beforeDragElement: TElement | null = null;
  let isCloneDrag = false;
  const throttledPatch = portal.createThrottledPatch((element) => {
    if (portal.crdt.doc().elements[element.id] === undefined) {
      return;
    }

    const builder = portal.crdt.build();
    builder.patchElement(element.id, "x", element.x);
    builder.patchElement(element.id, "y", element.y);
    builder.patchElement(element.id, "updatedAt", element.updatedAt);
    builder.commit();
  });

  args.node.on("pointerclick", (event) => {
    portal.hooks.elementPointerClick.call(event);
  });

  args.node.on("pointerdown", (event) => {
    const didHandle = portal.hooks.elementPointerDown.call(event);
    if (didHandle) {
      event.cancelBubble = true;
    }
  });

  args.node.on("pointerdblclick", (event) => {
    const didHandle = portal.hooks.elementPointerDoubleClick.call(event);
    if (didHandle) {
      event.cancelBubble = true;
    }
  });

  args.node.on("dragstart", (event) => {
    if (event.evt?.altKey) {
      isCloneDrag = true;
      stopDragSafely(args.node);

      portal.startDragClone({
        node: args.node,
        selection: portal.selection.selection,
      });
      return;
    }

    const timestamp = portal.now();
    beforeDragElement = portal.serializeNode({ node: args.node, createdAt: timestamp, updatedAt: timestamp });
  });

  args.node.on("dragmove", () => {
    if (isCloneDrag) {
      return;
    }

    const timestamp = portal.now();
    throttledPatch(portal.serializeNode({
      node: args.node,
      createdAt: beforeDragElement?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }));
  });

  args.node.on("dragend", () => {
    if (isCloneDrag) {
      isCloneDrag = false;
      beforeDragElement = null;
      return;
    }
    const timestamp = portal.now();
    const afterDragElement = portal.serializeNode({
      node: args.node,
      createdAt: beforeDragElement?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    const dragBuilder = portal.crdt.build();
    dragBuilder.patchElement(afterDragElement.id, afterDragElement);
    const dragCommitResult = dragBuilder.commit();

    if (!beforeDragElement) {
      return;
    }

    const didMove = beforeDragElement.x !== afterDragElement.x || beforeDragElement.y !== afterDragElement.y;
    if (!didMove) {
      beforeDragElement = null;
      return;
    }

    const undoElement = structuredClone(beforeDragElement);
    const redoElement = structuredClone(afterDragElement);
    beforeDragElement = null;

    portal.history.record({
      label: "drag-text",
      undo: () => {
        txUpdateTextNodeFromElement({ Konva: portal.Konva, scene: portal.render, theme: portal.theme }, { element: undoElement, freeTextName: args.freeTextName });
        portal.render.staticForegroundLayer.batchDraw();
        dragCommitResult.rollback();
      },
      redo: () => {
        txUpdateTextNodeFromElement({ Konva: portal.Konva, scene: portal.render, theme: portal.theme }, { element: redoElement, freeTextName: args.freeTextName });
        portal.render.staticForegroundLayer.batchDraw();
        portal.crdt.applyOps({ ops: dragCommitResult.redoOps });
      },
    });
  });
}
