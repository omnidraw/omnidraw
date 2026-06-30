import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { RenderOrderService } from "../../services/render-order/RenderOrderService";
import type { SceneService } from "../../services/scene/SceneService";
import type { SelectionService } from "../../services/selection/SelectionService";
import type { ThemeService, TThemeDefinition } from "@vibecanvas/service-theme";
import type { StrokeOptions } from "perfect-freehand";
import { txCreatePenPathFromElement } from "./tx.path";

type TGetStroke = (
  points: [number, number, number][],
  options: StrokeOptions,
) => number[][];

export type TPortalTxCreatePenPreviewClone = {
  Path: typeof Konva.Path;
  crdt: CrdtService;
  render: SceneService;
  renderOrder: RenderOrderService;
  selection: SelectionService;
  theme: ThemeService;
  createId: () => string;
  now: () => number;
  getStroke: TGetStroke;
  resolveThemeColor: (theme: string | TThemeDefinition, value: string | undefined, fallback?: string | undefined) => string | undefined;
  setupNode: (node: Konva.Path) => Konva.Path;
  toElement: (node: Konva.Path) => TElement;
};
export type TArgsTxCreatePenPreviewClone = {
  node: Konva.Path;
};

export function txCreatePenPreviewClone(portal: TPortalTxCreatePenPreviewClone, args: TArgsTxCreatePenPreviewClone) {
  const element = portal.toElement(args.node);
  const now = portal.now();
  const clone = txCreatePenPathFromElement({
    Path: portal.Path,
    render: portal.render,
    theme: portal.theme,
    getStroke: portal.getStroke,
    resolveThemeColor: portal.resolveThemeColor,
  }, {
    element: {
      ...element,
      id: portal.createId(),
      parentGroupId: null,
      createdAt: now,
      updatedAt: now,
      data: structuredClone(element.data),
      style: structuredClone(element.style),
      zIndex: "",
    },
  });

  clone.setDraggable(true);
  return clone;
}

export type TPortalTxFinalizePenPreviewClone = TPortalTxCreatePenPreviewClone;
export type TArgsTxFinalizePenPreviewClone = {
  previewClone: Konva.Path;
};

export function txFinalizePenPreviewClone(portal: TPortalTxFinalizePenPreviewClone, args: TArgsTxFinalizePenPreviewClone) {
  if (args.previewClone.isDragging()) {
    args.previewClone.stopDrag();
  }

  args.previewClone.moveTo(portal.render.staticForegroundLayer);
  portal.setupNode(args.previewClone);
  args.previewClone.setDraggable(true);
  args.previewClone.listening(true);
  args.previewClone.visible(true);

  const element = portal.toElement(args.previewClone);
  const builder = portal.crdt.build();
  builder.patchElement(element.id, element);
  builder.commit();

  portal.renderOrder.assignOrderOnInsert({
    parent: portal.render.staticForegroundLayer,
    nodes: [args.previewClone],
    position: "front",
  });
  portal.render.dynamicLayer.batchDraw();
  portal.render.staticForegroundLayer.batchDraw();
  return args.previewClone;
}

export type TPortalTxCreatePenCloneDrag = TPortalTxCreatePenPreviewClone;
export type TArgsTxCreatePenCloneDrag = {
  node: Konva.Path;
};

export function txCreatePenCloneDrag(portal: TPortalTxCreatePenCloneDrag, args: TArgsTxCreatePenCloneDrag) {
  const previewClone = txCreatePenPreviewClone(portal, { node: args.node });
  portal.render.dynamicLayer.add(previewClone);
  previewClone.startDrag();

  const finalizeCloneDrag = () => {
    previewClone.off("dragend", finalizeCloneDrag);
    const cloned = txFinalizePenPreviewClone(portal, { previewClone });
    portal.selection.setSelection([cloned]);
    portal.selection.setFocusedNode(cloned);
  };

  previewClone.on("dragend", finalizeCloneDrag);
  return previewClone;
}
