import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import type { SceneService, SelectionService, SessionService } from "../../services";
import {
  EDIT_HANDLE_FILL,
  EDIT_HANDLE_RADIUS,
  EDIT_HANDLE_STROKE,
  INSERT_HANDLE_RADIUS,
  type THandleDragSnapshot,
  type TPoint,
  type TShape1dData,
  type TShape1dNode,
} from "./CONSTANTS";
import { txRecordElementHistory, type TPortalTxRecordShape1dHistory } from "./tx.history";
import type { TShape1dPluginState } from "./typed";
import type Konva from "konva";

function txRefreshShape1dEditHandlePositions(portal: TPortalTxShape1dEditMode, args: TArgsTxRefreshShape1dEditHandlePositions) {
  const data = portal.getData(args.node);
  if (!data) {
    return;
  }

  portal.state.anchorHandles.forEach((handle, pointIndex) => {
    const point = data.points[pointIndex];
    if (point) {
      handle.position(portal.toWorld(args.node, point));
    }
  });
  portal.state.insertHandles.forEach((handle, segmentIndex) => {
    handle.position(portal.toWorld(args.node, portal.insertionPoint(data, segmentIndex)));
  });
  portal.render.dynamicLayer.batchDraw();
}

function txRenderShape1dEditHandles(portal: TPortalTxShape1dEditMode, args: TArgsTxRenderShape1dEditHandles) {
  txClearShape1dEditHandles(portal);
  const data = portal.getData(args.node);
  if (!data || data.points.length === 0) {
    return;
  }

  data.points.forEach((point, pointIndex) => {
    const worldPoint = portal.toWorld(args.node, point);
    const handle = new portal.Circle({
      x: worldPoint.x,
      y: worldPoint.y,
      radius: EDIT_HANDLE_RADIUS,
      fill: EDIT_HANDLE_FILL,
      stroke: EDIT_HANDLE_STROKE,
      strokeWidth: 2,
      draggable: true,
    });

    handle.setAttr("vcInteractionOverlay", true);
    handle.setAttr("vcShape1dHandleKind", "anchor");
    handle.setAttr("vcShape1dPointIndex", pointIndex);
    handle.on("dragstart", () => {
      const editableNode = portal.findNode(args.node.id());
      if (!editableNode) {
        return;
      }

      portal.state.activeHandleDrag = {
        nodeId: editableNode.id(),
        pointIndex,
        beforeElement: portal.toElement(editableNode),
        beforePoints: structuredClone(portal.getData(editableNode)?.points ?? []),
        beforeAbsoluteTransform: editableNode.getAbsoluteTransform().copy(),
      } satisfies THandleDragSnapshot;
    });
    handle.on("dragmove", () => {
      const drag = portal.state.activeHandleDrag;
      if (!drag) {
        return;
      }

      const editableNode = portal.findNode(drag.nodeId);
      const pointer = portal.render.dynamicLayer.getRelativePointerPosition();
      if (!editableNode || !pointer) {
        return;
      }

      portal.applyAnchorDrag(editableNode, drag, { x: pointer.x, y: pointer.y });
      txRefreshShape1dEditHandlePositions(portal, { node: editableNode });
    });
    handle.on("dragend", () => {
      const drag = portal.state.activeHandleDrag;
      portal.state.activeHandleDrag = null;
      if (!drag) {
        return;
      }

      const editableNode = portal.findNode(drag.nodeId);
      if (!editableNode) {
        return;
      }

      const afterElement = portal.toElement(editableNode);
      txRecordElementHistory(portal.historyPortal, {
        beforeElement: drag.beforeElement,
        afterElement,
        label: "edit-shape1d-point",
      });
      txRenderShape1dEditHandles(portal, { node: editableNode });
    });
    portal.render.dynamicLayer.add(handle);
    portal.state.anchorHandles.push(handle);
  });

  for (let index = 0; index < data.points.length - 1; index += 1) {
    const insertPoint = portal.insertionPoint(data, index);
    const worldPoint = portal.toWorld(args.node, insertPoint);
    const handle = new portal.Circle({
      x: worldPoint.x,
      y: worldPoint.y,
      radius: INSERT_HANDLE_RADIUS,
      fill: "rgba(255,255,255,0.92)",
      stroke: EDIT_HANDLE_STROKE,
      strokeWidth: 2,
      dash: [2, 2],
      draggable: true,
    });

    handle.setAttr("vcInteractionOverlay", true);
    handle.setAttr("vcShape1dHandleKind", "insert");
    handle.setAttr("vcShape1dSegmentIndex", index);
    handle.on("dragstart", () => {
      const editableNode = portal.findNode(args.node.id());
      if (!editableNode) {
        return;
      }

      const beforeElement = portal.toElement(editableNode);
      const currentData = portal.getData(editableNode);
      if (!currentData) {
        return;
      }

      const createdPoint = portal.insertionPoint(currentData, index);
      const nextData = structuredClone(currentData);
      nextData.points.splice(index + 1, 0, createdPoint);
      editableNode.setAttr(ELEMENT_DATA_ATTR, nextData);
      editableNode.getLayer()?.batchDraw();
      handle.setAttr("vcShape1dHandleKind", "anchor");
      handle.setAttr("vcShape1dPointIndex", index + 1);
      portal.state.activeHandleDrag = {
        nodeId: editableNode.id(),
        pointIndex: index + 1,
        beforeElement,
        beforePoints: structuredClone(currentData.points),
        beforeAbsoluteTransform: editableNode.getAbsoluteTransform().copy(),
      } satisfies THandleDragSnapshot;
    });
    handle.on("dragmove", () => {
      const drag = portal.state.activeHandleDrag;
      if (!drag) {
        return;
      }

      const editableNode = portal.findNode(drag.nodeId);
      const pointer = portal.render.dynamicLayer.getRelativePointerPosition();
      if (!editableNode || !pointer) {
        return;
      }

      portal.applyAnchorDrag(editableNode, drag, { x: pointer.x, y: pointer.y });
      const updatedPoint = portal.getData(editableNode)?.points[drag.pointIndex];
      if (updatedPoint) {
        handle.position(portal.toWorld(editableNode, updatedPoint));
      }
      portal.render.dynamicLayer.batchDraw();
    });
    handle.on("dragend", () => {
      const drag = portal.state.activeHandleDrag;
      portal.state.activeHandleDrag = null;
      if (!drag) {
        return;
      }

      const editableNode = portal.findNode(drag.nodeId);
      if (!editableNode) {
        return;
      }

      const afterElement = portal.toElement(editableNode);
      txRecordElementHistory(portal.historyPortal, {
        beforeElement: drag.beforeElement,
        afterElement,
        label: "insert-shape1d-point",
      });
      txRenderShape1dEditHandles(portal, { node: editableNode });
    });
    handle.on("pointerclick", (event: Konva.KonvaEventObject<PointerEvent>) => {
      if (portal.state.activeHandleDrag) {
        return;
      }

      event.cancelBubble = true;
      const editableNode = portal.findNode(args.node.id());
      const currentData = editableNode ? portal.getData(editableNode) : null;
      if (!editableNode || !currentData) {
        return;
      }

      const beforeElement = portal.toElement(editableNode);
      const nextData = structuredClone(currentData);
      nextData.points.splice(index + 1, 0, insertPoint);
      editableNode.setAttr(ELEMENT_DATA_ATTR, nextData);
      editableNode.getLayer()?.batchDraw();
      const afterElement = portal.toElement(editableNode);
      txRecordElementHistory(portal.historyPortal, {
        beforeElement,
        afterElement,
        label: "insert-shape1d-point",
      });
      txRenderShape1dEditHandles(portal, { node: editableNode });
    });
    portal.render.dynamicLayer.add(handle);
    portal.state.insertHandles.push(handle);
  }

  portal.state.anchorHandles.forEach((handle) => {
    handle.moveToTop();
  });
  portal.state.insertHandles.forEach((handle) => {
    handle.moveToTop();
  });
  portal.render.dynamicLayer.batchDraw();
}

export type TPortalTxShape1dEditMode = {
  state: TShape1dPluginState;
  Circle: typeof Konva.Circle;
  session: SessionService;
  render: SceneService;
  selection: SelectionService;
  historyPortal: TPortalTxRecordShape1dHistory;
  findNode: (id: string) => TShape1dNode | null;
  getData: (node: TShape1dNode) => TShape1dData | null;
  toWorld: (node: TShape1dNode, point: TPoint | { x: number; y: number }) => { x: number; y: number };
  insertionPoint: (data: TShape1dData, segmentIndex: number) => TPoint;
  applyAnchorDrag: (node: TShape1dNode, drag: THandleDragSnapshot, worldPoint: { x: number; y: number }) => void;
  toElement: (node: TShape1dNode) => TElement;
};

export type TArgsTxRefreshShape1dEditHandlePositions = {
  node: TShape1dNode;
};

export function txClearShape1dEditHandles(portal: TPortalTxShape1dEditMode) {
  portal.state.anchorHandles.forEach((handle) => {
    handle.destroy();
  });
  portal.state.insertHandles.forEach((handle) => {
    handle.destroy();
  });
  portal.state.anchorHandles = [];
  portal.state.insertHandles = [];
  portal.render.dynamicLayer.batchDraw();
}

export type TArgsTxExitShape1dEditMode = {
  preserveSelection?: boolean;
};

export function txExitShape1dEditMode(portal: TPortalTxShape1dEditMode, args?: TArgsTxExitShape1dEditMode) {
  const editingId = portal.session.editingId;
  if (editingId !== null) {
    const node = portal.findNode(editingId);
    if (node) {
      const previousDraggable = node.getAttr("vcShape1dPrevDraggable");
      node.draggable(typeof previousDraggable === "boolean" ? previousDraggable : true);
      node.setAttr("vcShape1dPrevDraggable", undefined);
    }
  }

  portal.state.activeHandleDrag = null;
  txClearShape1dEditHandles(portal);
  portal.session.editingId = null;
  if (!args?.preserveSelection && portal.selection.selection.length === 1 && portal.selection.selection[0]?.id() === editingId) {
    portal.selection.clear();
  }
}

export type TArgsTxEnterShape1dEditMode = {
  node: TShape1dNode;
};

export function txEnterShape1dEditMode(portal: TPortalTxShape1dEditMode, args: TArgsTxEnterShape1dEditMode) {
  if (portal.session.editingId === args.node.id()) {
    txRenderShape1dEditHandles(portal, { node: args.node });
    return;
  }

  txExitShape1dEditMode(portal, { preserveSelection: true });
  args.node.setAttr("vcShape1dPrevDraggable", args.node.draggable());
  args.node.draggable(false);
  portal.selection.setSelection([args.node]);
  portal.selection.setFocusedNode(args.node);
  portal.session.editingId = args.node.id();
  txRenderShape1dEditHandles(portal, { node: args.node });
}

export function txRefreshShape1dEditMode(portal: TPortalTxShape1dEditMode) {
  const editingId = portal.session.editingId;
  if (!editingId) {
    txClearShape1dEditHandles(portal);
    return;
  }

  const node = portal.findNode(editingId);
  const filteredSelection = fnFilterSelection({
    selection: portal.selection.selection,
  });
  if (!node || filteredSelection.length !== 1 || filteredSelection[0] !== node) {
    txExitShape1dEditMode(portal);
    return;
  }

  txRenderShape1dEditHandles(portal, { node });
}

export type TArgsTxRenderShape1dEditHandles = {
  node: TShape1dNode;
};
