import type { TElement, TImageData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnGetAbsolutePositionFromWorldPosition } from "../../core/fn.world-position";
import type Konva from "konva";

export type TPortalUpdateImageNodeFromElement = {
  setNodeZIndex: (node: Konva.Image, zIndex: string) => void;
  syncNodeMetadata: (node: Konva.Image, element: TElement) => void;
  getImageSource: (args: { url: string | null; base64: string | null }) => string | null;
  loadImageIntoNode: (node: Konva.Image, source: string | null) => void;
  batchDraw: () => void;
};

export type TArgsUpdateImageNodeFromElement = {
  node: Konva.Image;
  element: TElement;
};

export function txUpdateImageNodeFromElement(
  portal: TPortalUpdateImageNodeFromElement,
  args: TArgsUpdateImageNodeFromElement,
) {
  const data = args.element.data as TImageData;
  args.node.absolutePosition(fnGetAbsolutePositionFromWorldPosition({
    worldPosition: { x: args.element.x, y: args.element.y },
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  }));

  if (args.node.getAbsoluteRotation() !== args.element.rotation) {
    args.node.rotation(args.element.rotation);
  }

  if (args.node.width() !== data.w) {
    args.node.width(data.w);
  }

  if (args.node.height() !== data.h) {
    args.node.height(data.h);
  }

  if (args.node.scaleX() !== (args.element.scaleX ?? 1)) {
    args.node.scaleX(args.element.scaleX ?? 1);
  }

  if (args.node.scaleY() !== (args.element.scaleY ?? 1)) {
    args.node.scaleY(args.element.scaleY ?? 1);
  }

  if (args.node.opacity() !== (args.element.style.opacity ?? 1)) {
    args.node.opacity(args.element.style.opacity ?? 1);
  }

  portal.setNodeZIndex(args.node, args.element.zIndex);
  portal.syncNodeMetadata(args.node, args.element);

  const nextSource = portal.getImageSource({ url: data.url, base64: data.base64 });
  if (args.node.getAttr("vcImageSource") !== nextSource) {
    portal.loadImageIntoNode(args.node, nextSource);
  }

  portal.batchDraw();
}
