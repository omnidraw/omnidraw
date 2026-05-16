import type { TElement, TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import {
  ELEMENT_DATA_ATTR,
  ELEMENT_STYLE_ATTR,
  VC_CREATED_AT_ATTR,
  VC_UPDATED_AT_ATTR,
} from "../../core/CONSTANTS";
import { fnGetAbsolutePositionFromWorldPosition } from "../../core/fn.world-position";
import { txSetNodeZIndex } from "../../core/tx.set-node-z-index";
import {
  WIDGET_CONNECTION_BOUNDARY_ID,
  WIDGET_CONNECTION_BOUNDARY_OFFSET,
  WIDGET_CONNECTION_HANDLE_ID,
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
import { txSyncWidgetDomPortals } from "./tx.sync-widget-dom-portals";

export type TPortalUpdateWidgetNodeFromElement = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  Rect: typeof Konva.Rect;
};

export type TArgsUpdateWidgetNodeFromElement = {
  node: Konva.Node;
  element: TElement;
};

function syncWidgetMetadata(args: {
  node: Konva.Group;
  element: TElement;
  data: TUiWidgetData | TWidgetData;
}) {
  args.node.setAttr(ELEMENT_DATA_ATTR, args.data);
  args.node.setAttr(ELEMENT_STYLE_ATTR, args.element.style ?? {});
  args.node.setAttr(VC_CREATED_AT_ATTR, args.element.createdAt);
  args.node.setAttr(VC_UPDATED_AT_ATTR, args.element.updatedAt);
}

function syncConnectionBoundary(portal: TPortalUpdateWidgetNodeFromElement, args: { node: Konva.Group; width: number; height: number }) {
  if (!portal.Line) return;

  const boundary = args.node.findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`);
  if (!(boundary instanceof portal.Line)) return;

  const offset = WIDGET_CONNECTION_BOUNDARY_OFFSET;
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

  const handle = args.node.findOne(`#${WIDGET_CONNECTION_HANDLE_ID}`);
  if (handle) handle.visible(false);
}

function syncWidgetChrome(portal: TPortalUpdateWidgetNodeFromElement, args: {
  node: Konva.Group;
  width: number;
  height: number;
  expanded: boolean;
  connectable: boolean;
}) {
  const bodyHeight = Math.max(WIDGET_HOST_MIN_BODY_HEIGHT, args.height - WIDGET_HOST_HEADER_HEIGHT);
  const height = Math.max(WIDGET_HOST_MIN_HEIGHT, WIDGET_HOST_HEADER_HEIGHT + bodyHeight);
  const width = Math.max(WIDGET_HOST_MIN_WIDTH, args.width);

  args.node.width(width);
  args.node.height(height);
  args.node.scale({ x: 1, y: 1 });

  syncConnectionBoundary(portal, { node: args.node, width, height });
  const connectionBoundary = args.node.findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`);
  if (connectionBoundary) {
    connectionBoundary.visible(args.connectable);
    connectionBoundary.listening(args.connectable);
  }

  const border = args.node.findOne(`#${WIDGET_HOST_BORDER_ID}`);
  if (border instanceof portal.Rect) {
    border.width(width);
    border.height(args.expanded ? height : WIDGET_HOST_HEADER_HEIGHT);
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
    divider.visible(args.expanded);
    divider.listening(false);
  }

  const body = args.node.findOne(`#${WIDGET_HOST_BODY_ID}`);
  if (body instanceof portal.Rect) {
    body.y(WIDGET_HOST_HEADER_HEIGHT);
    body.width(width);
    body.height(bodyHeight);
    body.visible(args.expanded);
    body.listening(args.expanded);
  }
}

export function txUpdateWidgetNodeFromElement(
  portal: TPortalUpdateWidgetNodeFromElement,
  args: TArgsUpdateWidgetNodeFromElement,
) {
  if (!(args.node instanceof portal.Group) || (args.element.data.type !== "widget" && args.element.data.type !== "ui-widget")) {
    return false;
  }

  const width = Math.max(WIDGET_HOST_MIN_WIDTH, args.element.data.w);
  const height = Math.max(WIDGET_HOST_MIN_HEIGHT, args.element.data.h);
  const expanded = args.element.data.expanded !== false;
  const absolutePosition = fnGetAbsolutePositionFromWorldPosition({
    worldPosition: { x: args.element.x, y: args.element.y },
    parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
  });

  args.node.absolutePosition(absolutePosition);
  args.node.rotation(args.element.rotation);

  syncWidgetChrome(portal, {
    node: args.node,
    width,
    height,
    expanded,
    connectable: args.element.data.type === "widget",
  });
  syncWidgetMetadata({
    node: args.node,
    element: args.element,
    data: {
      ...args.element.data,
      w: width,
      h: height,
      expanded,
    },
  });
  txSetNodeZIndex({}, { node: args.node, zIndex: args.element.zIndex });
  txSyncWidgetDomPortals({}, { node: args.node });
  args.node.getLayer()?.batchDraw();

  return true;
}
