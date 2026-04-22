import type { Shape, ShapeConfig } from "konva/lib/Shape";
import type { SceneService } from "../../services/scene/SceneService";

type TPortalFxGetProxyBounds = {
  scene: SceneService;
};

type TArgsFxGetProxyBounds = {
  node: Shape<ShapeConfig>;
};

export function fxGetProxyBounds(portal: TPortalFxGetProxyBounds, args: TArgsFxGetProxyBounds) {
  const localRect = args.node.getClientRect({ relativeTo: args.node });
  const nodeTransform = args.node.getAbsoluteTransform();
  const layerInverseTransform = portal.scene.staticForegroundLayer.getAbsoluteTransform().copy();
  layerInverseTransform.invert();

  const topLeft = layerInverseTransform.point(nodeTransform.point({ x: localRect.x, y: localRect.y }));
  const topRight = layerInverseTransform.point(nodeTransform.point({ x: localRect.x + localRect.width, y: localRect.y }));
  const bottomLeft = layerInverseTransform.point(nodeTransform.point({ x: localRect.x, y: localRect.y + localRect.height }));

  return {
    position: topLeft,
    width: Math.max(1, Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y)),
    height: Math.max(1, Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y)),
    rotation: Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180 / Math.PI,
  };
}
