import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TThemeDefinition } from "@vibecanvas/service-theme";
import type { CrdtService, ElementService, HistoryService, RenderOrderService, SceneService, SelectionService } from "../../services";
import { fxFindShape1dNodeById, type TPortalFxFindShape1dNodeById } from "./fx.node";
import type { TShape1dNode } from "./CONSTANTS";
import { txCreateShapeFromElement } from "./tx.render";

export type TPortalTxRecordShape1dHistory = {
  Shape: typeof Konva.Shape;
  element: ElementService;
  crdt: CrdtService;
  history: HistoryService;
  render: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: { getTheme(): string | TThemeDefinition };
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
  createShapeNode: (config?: Record<string, unknown>) => TShape1dNode;
  setNodeZIndex: (node: TShape1dNode, zIndex: string) => void;
  setupNode: (node: TShape1dNode) => TShape1dNode;
};
export type TArgsTxRecordElementHistory = { beforeElement: TElement; afterElement: TElement; label: string };
export function txRecordElementHistory(portal: TPortalTxRecordShape1dHistory, args: TArgsTxRecordElementHistory) {
  if (JSON.stringify(args.beforeElement) === JSON.stringify(args.afterElement)) {
    return;
  }

  const commitResult = (() => {
    const builder = portal.crdt.build();
    builder.patchElement(args.afterElement.id, args.afterElement);
    return builder.commit();
  })();

  portal.history.record({
    label: args.label,
    undo() {
      portal.element.updateElement(args.beforeElement);
      commitResult.rollback();
    },
    redo() {
      portal.element.updateElement(args.afterElement);
      portal.crdt.applyOps({ ops: commitResult.redoOps });
    },
  });
}

export type TArgsTxRecordCreateHistory = { element: TElement; node: TShape1dNode; label: string };
export function txRecordCreateHistory(portal: TPortalTxRecordShape1dHistory, args: TArgsTxRecordCreateHistory) {
  const snapshot = structuredClone(args.element);
  const commitResult = (() => {
    const builder = portal.crdt.build();
    builder.patchElement(snapshot.id, snapshot);
    return builder.commit();
  })();

  portal.history.record({
    label: args.label,
    undo() {
      const currentNode = fxFindShape1dNodeById({ Shape: portal.Shape, render: portal.render } satisfies TPortalFxFindShape1dNodeById, { id: snapshot.id });
      currentNode?.destroy();
      commitResult.rollback();

      const nextSelection = portal.selection.selection.filter((candidate) => candidate.id() !== snapshot.id);
      portal.selection.setSelection(nextSelection);
      if (portal.selection.focusedId === snapshot.id) {
        portal.selection.setFocusedId(nextSelection.at(-1)?.id() ?? null);
      }

      portal.render.staticForegroundLayer.batchDraw();
    },
    redo() {
      let currentNode = fxFindShape1dNodeById({ Shape: portal.Shape, render: portal.render }, { id: snapshot.id });
      if (!currentNode) {
        currentNode = portal.setupNode(txCreateShapeFromElement({
          createShapeNode: portal.createShapeNode,
          setNodeZIndex: portal.setNodeZIndex,
          theme: portal.theme,
          resolveThemeColor: portal.resolveThemeColor,
        }, { element: snapshot }));
        currentNode.setDraggable(true);
        portal.render.staticForegroundLayer.add(currentNode);
      }

      portal.element.updateElement(snapshot);
      portal.renderOrder.sortChildren(portal.render.staticForegroundLayer);
      portal.crdt.applyOps({ ops: commitResult.redoOps });
      portal.selection.setSelection([currentNode]);
      portal.selection.setFocusedNode(currentNode);
      portal.render.staticForegroundLayer.batchDraw();
    },
  });

  portal.selection.setSelection([args.node]);
  portal.selection.setFocusedNode(args.node);
}
