import type { TElement, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { TElementTransformAnchor } from "../element/types";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_MIN_BODY_HEIGHT,
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
  WIDGET_HOST_WINDOW_STROKE_WIDTH,
} from "./CONSTANTS";

type TPortal = {
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  Rect: typeof Konva.Rect;
}

type TArgs = {
  node: Konva.Node;
  anchors?: TElementTransformAnchor[];
}

const TRANSFORM_BEFORE_ELEMENT_ATTR = "vcTransformBeforeElement";
const WIDGET_CONNECTION_BOUNDARY_ID = "widget-connection-boundary";

function txSyncConnectionBoundary(portal: TPortal, args: { node: Konva.Group; width: number; height: number }) {
  if (!portal.Line) return;

  const boundary = args.node.findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`);
  if (!(boundary instanceof portal.Line)) return;

  const offset = 10;
  const radius = 18;
  const left = -offset;
  const top = -offset;
  const right = args.width + offset;
  const bottom = args.height + offset;
  const corner = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
  const segments = 8;
  const points: number[] = [];

  const addArc = (centerX: number, centerY: number, startAngle: number, endAngle: number) => {
    for (let index = 0; index <= segments; index += 1) {
      const amount = index / segments;
      const angle = startAngle + (endAngle - startAngle) * amount;
      points.push(centerX + Math.cos(angle) * corner, centerY + Math.sin(angle) * corner);
    }
  };

  addArc(right - corner, top + corner, -Math.PI / 2, 0);
  addArc(right - corner, bottom - corner, 0, Math.PI / 2);
  addArc(left + corner, bottom - corner, Math.PI / 2, Math.PI);
  addArc(left + corner, top + corner, Math.PI, Math.PI * 1.5);

  boundary.points(points);
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
  if (beforeElement?.data.type === "widget") {
    if (args.anchors?.some((anchor) => anchor.endsWith("left"))) {
      args.node.x(beforeElement.x + beforeElement.data.w - width);
    }
    if (args.anchors?.some((anchor) => anchor.startsWith("top"))) {
      args.node.y(beforeElement.y + beforeElement.data.h - height);
    }
  }

  args.node.width(width);
  args.node.height(height);
  args.node.scale({ x: 1, y: 1 });

  txSyncConnectionBoundary(portal, { node: args.node, width, height });

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

  const data = args.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined;
  if (data?.type === "widget") {
    args.node.setAttr(ELEMENT_DATA_ATTR, {
      ...data,
      w: width,
      h: height,
      expanded: true,
    } satisfies TWidgetData);
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
