import type { ThemeService } from "@vibecanvas/service-theme";
import type Konva from "konva";
import type { SceneService } from "../../services/scene/SceneService";

export type TPortalCreateGroupBoundary = {
  Rect: typeof Konva.Rect;
  scene: SceneService;
  theme: ThemeService;
};

export type TArgsCreateGroupBoundary = {
  group: Konva.Group;
};

export function fxCreateGroupBoundary(
  portal: TPortalCreateGroupBoundary,
  args: TArgsCreateGroupBoundary,
) {
  const boundary = new portal.Rect({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    stroke: portal.theme.getTheme().colors.canvasGroupBoundary,
    dash: [11, 11],
    strokeWidth: 2,
    strokeScaleEnabled: false,
    draggable: false,
    listening: false,
    visible: false,
    name: `group-boundary:${args.group.id()}`,
  });

  const getBoundaryBox = () => {
    const groupRect = args.group.getClientRect({ relativeTo: args.group });

    return {
      x: groupRect.x,
      y: groupRect.y,
      width: groupRect.width,
      height: groupRect.height,
    };
  };

  const update = () => {
    const box = getBoundaryBox();
    const groupTransform = args.group.getAbsoluteTransform();
    const dynamicLayerInverseTransform = portal.scene.dynamicLayer.getAbsoluteTransform().copy();
    dynamicLayerInverseTransform.invert();

    const topLeft = dynamicLayerInverseTransform.point(groupTransform.point({ x: box.x, y: box.y }));
    const topRight = dynamicLayerInverseTransform.point(groupTransform.point({ x: box.x + box.width, y: box.y }));
    const bottomLeft = dynamicLayerInverseTransform.point(groupTransform.point({ x: box.x, y: box.y + box.height }));

    const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
    const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
    const rotation = Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180 / Math.PI;

    boundary.position(topLeft);
    boundary.rotation(rotation);
    boundary.scale({ x: 1, y: 1 });
    boundary.size({ width, height });
  };

  const syncTheme = () => {
    boundary.stroke(portal.theme.getTheme().colors.canvasGroupBoundary);
  };

  const show = () => {
    syncTheme();
    update();
    boundary.visible(true);
  };

  const hide = () => {
    boundary.visible(false);
  };

  return {
    node: boundary,
    update,
    show,
    hide,
    syncTheme,
    getBoundaryBox,
  };
}
