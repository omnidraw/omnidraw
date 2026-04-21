import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { CanvasRegistryService } from "../../services/canvas-registry/CanvasRegistryService";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { HistoryService } from "../../services/history/HistoryService";
import { txFinalizeOwnedTransform } from "../../core/tx.finalize-owned-transform";
import { fnGetShape1dSelectionStyleMenuConfig } from "./fn.selection-style";
import type { TShape1dData, TShape1dNode, TShape1dTool } from "./CONSTANTS";

function txResolveMatchingShape1dNode(
  portal: TPortalTxRegisterShape1dElement,
  node: Konva.Node | null | undefined,
  type: TShape1dTool,
) {
  if (!portal.isNode(node)) {
    return null;
  }

  const data = portal.getData(node);
  return data?.type === type ? node : null;
}

function txFinalizeShape1dTransform(
  portal: TPortalTxRegisterShape1dElement,
  args: {
    node: Konva.Node;
    type: TShape1dTool;
    label: string;
    beforeAttr: string;
  },
) {
  const shapeNode = txResolveMatchingShape1dNode(portal, args.node, args.type);
  if (!(args.node instanceof portal.Shape) || !shapeNode) {
    return false;
  }

  return txFinalizeOwnedTransform({
    crdt: portal.crdt,
    history: portal.history,
    applyElement: portal.applyElement,
    serializeAfterElement: (candidateNode) => {
      const nextShapeNode = txResolveMatchingShape1dNode(portal, candidateNode, args.type);
      if (!nextShapeNode) {
        return null;
      }

      const element = portal.toElement(nextShapeNode);
      portal.updateShape(nextShapeNode, element);
      return structuredClone(element);
    },
  }, {
    node: args.node,
    label: args.label,
    beforeAttr: args.beforeAttr,
  });
}

export type TPortalTxRegisterShape1dElement = {
  Shape: typeof Konva.Shape;
  canvasRegistry: CanvasRegistryService;
  crdt: CrdtService;
  history: HistoryService;
  applyElement: (element: TElement) => void;
  createShape: (element: TElement) => TShape1dNode;
  findNode: (id: string) => TShape1dNode | null;
  getData: (node: TShape1dNode) => TShape1dData | null;
  isNode: (node: Konva.Node | null | undefined) => node is TShape1dNode;
  setupNode: (node: TShape1dNode) => TShape1dNode;
  toElement: (node: TShape1dNode) => TElement;
  txCreateCloneDrag: (node: TShape1dNode) => void;
  txEnsureShapeMove: (node: TShape1dNode) => unknown;
  txPatchShapeMove: (node: TShape1dNode) => boolean;
  txFinalizeShapeMove: (node: TShape1dNode) => boolean;
  updateShape: (node: TShape1dNode, element: TElement) => void;
};

export type TArgsTxRegisterShape1dElement = {
  type: TShape1dTool;
  beforeAttr: string;
};

export function txRegisterShape1dElement(portal: TPortalTxRegisterShape1dElement, args: TArgsTxRegisterShape1dElement) {
  return portal.canvasRegistry.registerElement({
    id: args.type,
    matchesElement: (element) => element.data.type === args.type,
    matchesNode: (node) => txResolveMatchingShape1dNode(portal, node, args.type) !== null,
    toElement: (node) => {
      const shapeNode = txResolveMatchingShape1dNode(portal, node, args.type);
      if (!shapeNode) {
        return null;
      }

      return portal.toElement(shapeNode);
    },
    createNode: (element) => {
      if (element.data.type !== args.type) {
        return null;
      }

      return portal.createShape(element);
    },
    attachListeners: (node) => {
      const shapeNode = txResolveMatchingShape1dNode(portal, node, args.type);
      if (!shapeNode) {
        return false;
      }

      portal.setupNode(shapeNode);
      return true;
    },
    updateElement: (element) => {
      if (element.data.type !== args.type) {
        return false;
      }

      const node = portal.findNode(element.id);
      if (!node) {
        return false;
      }

      portal.updateShape(node, element);
      return true;
    },
    createDragClone: ({ node }) => {
      const shapeNode = txResolveMatchingShape1dNode(portal, node, args.type);
      if (!shapeNode) {
        return false;
      }

      portal.txCreateCloneDrag(shapeNode);
      return true;
    },
    getSelectionStyleMenu: () => fnGetShape1dSelectionStyleMenuConfig({ type: args.type }),
    getTransformOptions: () => ({
      enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
      keepRatio: false,
      flipEnabled: false,
    }),
    onMove: ({ node }) => {
      const shapeNode = txResolveMatchingShape1dNode(portal, node, args.type);
      if (!shapeNode) {
        return { cancel: false, crdt: false };
      }

      portal.txEnsureShapeMove(shapeNode);
      portal.txPatchShapeMove(shapeNode);
      return { cancel: true, crdt: false };
    },
    afterMove: ({ node }) => {
      const shapeNode = txResolveMatchingShape1dNode(portal, node, args.type);
      if (!shapeNode) {
        return { cancel: false, crdt: false };
      }

      portal.txFinalizeShapeMove(shapeNode);
      return { cancel: true, crdt: false };
    },
    afterResize: ({ node }) => ({
      cancel: txFinalizeShape1dTransform(portal, {
        node,
        type: args.type,
        label: "transform-shape1d",
        beforeAttr: args.beforeAttr,
      }),
      crdt: false,
    }),
    afterRotate: ({ node }) => ({
      cancel: txFinalizeShape1dTransform(portal, {
        node,
        type: args.type,
        label: "rotate-shape1d",
        beforeAttr: args.beforeAttr,
      }),
      crdt: false,
    }),
  });
}
