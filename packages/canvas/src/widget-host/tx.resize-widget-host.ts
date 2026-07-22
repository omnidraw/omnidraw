import type { TElement, TElementData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TElementTransformAnchor } from "../services/element/types";
import { ELEMENT_DATA_ATTR } from "../core/CONSTANTS";
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_MENU_BUTTON_ID,
  WIDGET_HOST_MENU_BUTTON_RIGHT_INSET,
  WIDGET_HOST_MENU_BUTTON_SIZE,
  WIDGET_HOST_TITLE_ID,
  WIDGET_HOST_TITLE_MENU_GAP,
  WIDGET_HOST_MIN_BODY_HEIGHT,
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
  WIDGET_HOST_WINDOW_STROKE_WIDTH,
} from "./CONSTANTS";
import {
  fnIsWidgetHostData,
  fnNormalizeWidgetHostData,
  fnPatchWidgetHostFrame,
} from "./fn.normalize-widget-host-data";

type TPortal = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  Rect: typeof Konva.Rect;
  Text?: typeof Konva.Text;
}

type TArgs = {
  node: Konva.Node;
  anchors?: TElementTransformAnchor[];
}

const TRANSFORM_BEFORE_ELEMENT_ATTR = "vcTransformBeforeElement";

function getMenuButtonX(width: number) {
  return Math.max(0, width - WIDGET_HOST_MENU_BUTTON_RIGHT_INSET - WIDGET_HOST_MENU_BUTTON_SIZE);
}

function getTitleWidth(args: {
  titleX: number;
  menuButtonX: number;
}) {
  return Math.max(0, args.menuButtonX - args.titleX - WIDGET_HOST_TITLE_MENU_GAP);
}

function txApplyWidgetHostSize(portal: TPortal, args: {
  node: Konva.Group;
  width: number;
  height: number;
  anchors?: TElementTransformAnchor[];
}) {
  const bodyHeight = Math.max(WIDGET_HOST_MIN_BODY_HEIGHT, args.height - WIDGET_HOST_HEADER_HEIGHT);
  const height = Math.max(WIDGET_HOST_MIN_HEIGHT, WIDGET_HOST_HEADER_HEIGHT + bodyHeight);
  const width = Math.max(WIDGET_HOST_MIN_WIDTH, args.width);

  const beforeElement = args.node.getAttr(TRANSFORM_BEFORE_ELEMENT_ATTR) as TElement | undefined;
  const beforeHostData = beforeElement
    ? fnNormalizeWidgetHostData(beforeElement.data)
    : null;
  if (beforeElement && beforeHostData) {
    if (args.anchors?.some((anchor) => anchor.endsWith("left"))) {
      args.node.x(beforeElement.x + beforeHostData.w - width);
    }
    if (args.anchors?.some((anchor) => anchor.startsWith("top"))) {
      args.node.y(beforeElement.y + beforeHostData.h - height);
    }
  }

  args.node.width(width);
  args.node.height(height);
  args.node.scale({ x: 1, y: 1 });

  const border = args.node.findOne(`#${WIDGET_HOST_BORDER_ID}`);
  if (border instanceof portal.Rect) {
    border.width(width);
    border.height(height);
  }

  const header = args.node.getChildren().find((child) => {
    return child instanceof portal.Group && child.id() === WIDGET_HOST_HEADER_ID;
  });
  if (header instanceof portal.Group) {
    const headerBackground = header.findOne(`#${WIDGET_HOST_HEADER_ID}`);
    if (headerBackground instanceof portal.Rect) {
      headerBackground.width(width);
      headerBackground.cornerRadius([WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0]);
    }

    const title = header.findOne(`#${WIDGET_HOST_TITLE_ID}`);
    if (portal.Text && title instanceof portal.Text) {
      const menuButtonX = getMenuButtonX(width);
      title.width(getTitleWidth({ titleX: title.x(), menuButtonX }));
    }

    const menuButton = header.findOne(`#${WIDGET_HOST_MENU_BUTTON_ID}`);
    if (menuButton instanceof portal.Group) {
      menuButton.x(getMenuButtonX(width));
    }
  }

  const divider = args.node.findOne(`#${WIDGET_HOST_DIVIDER_ID}`);
  if (divider instanceof portal.Rect) {
    divider.width(Math.max(0, width - WIDGET_HOST_WINDOW_STROKE_WIDTH * 2));
    divider.visible(true);
    divider.listening(false);
  }

  const body = args.node.findOne(`#${WIDGET_HOST_BODY_ID}`);
  if (body instanceof portal.Rect) {
    body.y(WIDGET_HOST_HEADER_HEIGHT);
    body.width(width);
    body.height(bodyHeight);
    body.visible(true);
    body.listening(true);
  }

  const data = args.node.getAttr(ELEMENT_DATA_ATTR) as TElementData | undefined;
  if (data && fnIsWidgetHostData(data)) {
    args.node.setAttr(ELEMENT_DATA_ATTR, fnPatchWidgetHostFrame(data, {
      w: width,
      h: height,
      expanded: true,
    }));
  }
  args.node.getLayer()?.batchDraw();
}

export function txResizeWidgetHost(portal: TPortal, args: TArgs) {
  if (!(args.node instanceof portal.Group)) {
    return false;
  }

  const scaledWidth = args.node.width() * Math.abs(args.node.scaleX());
  const scaledHeight = args.node.height() * Math.abs(args.node.scaleY());
  txApplyWidgetHostSize(portal, {
    node: args.node,
    width: scaledWidth,
    height: scaledHeight,
    anchors: args.anchors,
  });

  return true;
}
