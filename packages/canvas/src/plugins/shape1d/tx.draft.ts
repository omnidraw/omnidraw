import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type { ThemeService } from "@vibecanvas/service-theme";
import type { EditorService } from "../../services/editor/EditorService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import { CanvasMode } from "../../services/selection/CONSTANTS";
import { fnCreateDraftElement, fnCreateFallbackPreviewElement } from "./fn.draft";
import type { TShape1dTool, TShape1dNode } from "./CONSTANTS";
import { txRecordCreateHistory, type TPortalTxRecordShape1dHistory } from "./tx.history";
import type { TShape1dPluginState } from "./typed";

function txGetCurrentShape1dTool(portal: TPortalTxShape1dDraft): TShape1dTool | null {
  const tool = portal.editor.activeToolId;
  return tool === "line" || tool === "arrow" ? tool : null;
}

function txGetRememberedShape1dStyle(portal: TPortalTxShape1dDraft, tool: TShape1dTool | null) {
  return tool ? portal.theme.getRememberedStyle(tool) : {};
}

function txCreateDraftElementFromState(portal: TPortalTxShape1dDraft) {
  const tool = txGetCurrentShape1dTool(portal);
  if (!tool) {
    return null;
  }

  return fnCreateDraftElement({
    activeTool: tool,
    draftElementId: portal.state.draftElementId,
    draftStartPoint: portal.state.draftStartPoint,
    draftCurrentPoint: portal.state.draftCurrentPoint,
    createId: portal.createId,
    now: portal.now,
    rememberedStyle: txGetRememberedShape1dStyle(portal, tool),
  });
}

function txCreateFallbackPreviewElementFromState(portal: TPortalTxShape1dDraft) {
  const tool = txGetCurrentShape1dTool(portal);
  if (!tool) {
    return null;
  }

  return fnCreateFallbackPreviewElement({
    activeTool: tool,
    draftElementId: portal.state.draftElementId,
    createId: portal.createId,
    now: portal.now,
    rememberedStyle: txGetRememberedShape1dStyle(portal, tool),
  });
}

function txEnsureShape1dPreviewNode(portal: TPortalTxShape1dDraft) {
  if (portal.state.previewShape) {
    return portal.state.previewShape;
  }

  const previewElement = txCreateFallbackPreviewElementFromState(portal);
  if (!previewElement) {
    return null;
  }

  const previewShape = portal.createShape(previewElement);
  previewShape.listening(false);
  previewShape.visible(false);
  previewShape.draggable(false);
  portal.render.dynamicLayer.add(previewShape);
  portal.state.previewShape = previewShape;
  return previewShape;
}

export type TPortalTxShape1dDraft = {
  state: TShape1dPluginState;
  editor: EditorService;
  render: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: ThemeService;
  createId: () => string;
  now: () => number;
  createShape: (element: TElement) => TShape1dNode;
  updateShape: (node: TShape1dNode, element: TElement) => void;
  setupNode: (node: TShape1dNode) => TShape1dNode;
  toElement: (node: TShape1dNode) => TElement;
  historyPortal: TPortalTxRecordShape1dHistory;
};

export type TArgsTxStartShape1dDraft = {
  point: { x: number; y: number };
};

export function txResetShape1dDraft(portal: TPortalTxShape1dDraft) {
  portal.state.draftElementId = null;
  portal.state.draftStartPoint = null;
  portal.state.draftCurrentPoint = null;
}

export function txResetShape1dPreview(portal: TPortalTxShape1dDraft) {
  portal.state.previewShape?.destroy();
  portal.state.previewShape = null;
  portal.render.dynamicLayer.batchDraw();
}

export function txSyncShape1dPreview(portal: TPortalTxShape1dDraft) {
  const element = txCreateDraftElementFromState(portal);
  if (!element) {
    txResetShape1dPreview(portal);
    return;
  }

  const previewShape = txEnsureShape1dPreviewNode(portal);
  if (!previewShape) {
    return;
  }

  portal.updateShape(previewShape, element);
  previewShape.listening(false);
  previewShape.visible(true);
  previewShape.draggable(false);
  portal.render.dynamicLayer.batchDraw();
}

export function txStartShape1dDraft(portal: TPortalTxShape1dDraft, args: TArgsTxStartShape1dDraft) {
  portal.state.draftElementId = portal.createId();
  portal.state.draftStartPoint = [args.point.x, args.point.y];
  portal.state.draftCurrentPoint = [args.point.x, args.point.y];
  txSyncShape1dPreview(portal);
}

export type TArgsTxUpdateShape1dDraftCurrentPoint = {
  point: { x: number; y: number };
};

export function txUpdateShape1dDraftCurrentPoint(portal: TPortalTxShape1dDraft, args: TArgsTxUpdateShape1dDraftCurrentPoint) {
  portal.state.draftCurrentPoint = [args.point.x, args.point.y];
  txSyncShape1dPreview(portal);
}

export function txCancelShape1dDraft(portal: TPortalTxShape1dDraft) {
  if (!portal.state.previewShape && !portal.state.draftStartPoint) {
    return;
  }

  txResetShape1dDraft(portal);
  txResetShape1dPreview(portal);
  portal.editor.setActiveTool("select");
}

export function txFinalizeShape1dDraft(portal: TPortalTxShape1dDraft) {
  if (portal.selection.mode !== CanvasMode.DRAW_CREATE) {
    return;
  }

  if (!txGetCurrentShape1dTool(portal)) {
    return;
  }

  const element = txCreateDraftElementFromState(portal);
  txResetShape1dDraft(portal);
  txResetShape1dPreview(portal);
  portal.editor.setActiveTool("select");
  if (!element) {
    return;
  }

  const node = portal.setupNode(portal.createShape(element));
  portal.render.staticForegroundLayer.add(node);
  portal.renderOrder.assignOrderOnInsert({
    parent: portal.render.staticForegroundLayer,
    nodes: [node],
    position: "front",
  });
  txRecordCreateHistory(portal.historyPortal, {
    element: portal.toElement(node),
    node,
    label: "create-shape1d",
  });
  portal.render.staticForegroundLayer.batchDraw();
}
