import type Konva from "konva";

export type TPortalNodeSpace = Record<string, never>;

export type TArgsGetWorldPositionFromNode = {
  node: Konva.Node;
};

function getLayerTransform(node: Konva.Node) {
  const layer = node.getLayer();
  if (!layer) {
    return null;
  }

  return layer.getAbsoluteTransform().copy();
}

export function fxGetWorldPositionFromNode(
  portal: TPortalNodeSpace,
  args: TArgsGetWorldPositionFromNode,
) {
  void portal;

  const layerTransform = getLayerTransform(args.node);
  if (!layerTransform) {
    return { x: args.node.x(), y: args.node.y() };
  }

  const absolutePosition = args.node.getAbsolutePosition();
  layerTransform.invert();
  return layerTransform.point(absolutePosition);
}
