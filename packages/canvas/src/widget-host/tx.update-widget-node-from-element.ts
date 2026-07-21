import type { TElement, TUiWidgetData, TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import type { THostThemeColors } from "./types";
import {
  ELEMENT_DATA_ATTR,
  ELEMENT_STYLE_ATTR,
  VC_CREATED_AT_ATTR,
  VC_UPDATED_AT_ATTR,
} from "../core/CONSTANTS";
import { fnGetAbsolutePositionFromWorldPosition } from "../core/fn.world-position";
import { txSetNodeZIndex } from "../core/tx.set-node-z-index";
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_MENU_BUTTON_DOT_ID,
  WIDGET_HOST_MENU_BUTTON_HIT_ID,
  WIDGET_HOST_MENU_BUTTON_ID,
  WIDGET_HOST_MENU_BUTTON_RIGHT_INSET,
  WIDGET_HOST_MENU_BUTTON_SIZE,
  WIDGET_HOST_MENU_DOT_RADIUS,
  WIDGET_HOST_MENU_DOT_SPACING,
  WIDGET_HOST_TITLE_ID,
  WIDGET_HOST_TITLE_MENU_GAP,
  WIDGET_HOST_MIN_BODY_HEIGHT,
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MIN_WIDTH,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
  WIDGET_HOST_WINDOW_STROKE_WIDTH,
} from "./CONSTANTS";
import { txSyncWidgetDomPortals } from "./tx.sync-widget-dom-portals";

function getMenuButtonX(width: number) {
  return Math.max(0, width - WIDGET_HOST_MENU_BUTTON_RIGHT_INSET - WIDGET_HOST_MENU_BUTTON_SIZE);
}

function getTitleWidth(args: {
  titleX: number;
  menuButtonX: number;
}) {
  return Math.max(0, args.menuButtonX - args.titleX - WIDGET_HOST_TITLE_MENU_GAP);
}

function txEnsureMenuButton(portal: TPortalUpdateWidgetNodeFromElement, args: {
  header: Konva.Group;
  width: number;
  labelFill: string;
}) {
  const menuButtonX = getMenuButtonX(args.width);
  const existing = args.header.findOne(`#${WIDGET_HOST_MENU_BUTTON_ID}`);
  if (existing instanceof portal.Group) {
    existing.x(menuButtonX);
    const hit = existing.findOne(`#${WIDGET_HOST_MENU_BUTTON_HIT_ID}`);
    if (hit instanceof portal.Rect) {
      hit.fill(args.labelFill);
    }
    const Circle = portal.Circle;
    if (Circle) {
      existing.getChildren().forEach((child) => {
        if (child instanceof Circle) {
          child.fill(args.labelFill);
        }
      });
    }
    return;
  }

  if (!portal.Circle) {
    return;
  }

  const menuButton = new portal.Group({
    id: WIDGET_HOST_MENU_BUTTON_ID,
    x: menuButtonX,
    y: Math.floor((WIDGET_HOST_HEADER_HEIGHT - WIDGET_HOST_MENU_BUTTON_SIZE) / 2),
    width: WIDGET_HOST_MENU_BUTTON_SIZE,
    height: WIDGET_HOST_MENU_BUTTON_SIZE,
  });
  const menuHit = new portal.Rect({
    id: WIDGET_HOST_MENU_BUTTON_HIT_ID,
    x: 0,
    y: 0,
    width: WIDGET_HOST_MENU_BUTTON_SIZE,
    height: WIDGET_HOST_MENU_BUTTON_SIZE,
    fill: args.labelFill,
    opacity: 0,
    cornerRadius: 4,
  });
  const dotCenterY = WIDGET_HOST_MENU_BUTTON_SIZE / 2;
  const dotStartX = WIDGET_HOST_MENU_BUTTON_SIZE / 2 - WIDGET_HOST_MENU_DOT_SPACING;

  menuButton.add(menuHit);
  menuButton.add(new portal.Circle({
    id: `${WIDGET_HOST_MENU_BUTTON_DOT_ID}-left`,
    x: dotStartX,
    y: dotCenterY,
    radius: WIDGET_HOST_MENU_DOT_RADIUS,
    fill: args.labelFill,
    listening: false,
  }));
  menuButton.add(new portal.Circle({
    id: `${WIDGET_HOST_MENU_BUTTON_DOT_ID}-center`,
    x: WIDGET_HOST_MENU_BUTTON_SIZE / 2,
    y: dotCenterY,
    radius: WIDGET_HOST_MENU_DOT_RADIUS,
    fill: args.labelFill,
    listening: false,
  }));
  menuButton.add(new portal.Circle({
    id: `${WIDGET_HOST_MENU_BUTTON_DOT_ID}-right`,
    x: dotStartX + WIDGET_HOST_MENU_DOT_SPACING * 2,
    y: dotCenterY,
    radius: WIDGET_HOST_MENU_DOT_RADIUS,
    fill: args.labelFill,
    listening: false,
  }));
  args.header.add(menuButton);
}

export type TPortalUpdateWidgetNodeFromElement = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  Rect: typeof Konva.Rect;
  Text?: typeof Konva.Text;
};

export type TArgsUpdateWidgetNodeFromElement = {
  node: Konva.Node;
  element: TElement;
  label?: string;
  labelFill?: string;
  hostColors?: THostThemeColors;
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

function syncWidgetChrome(portal: TPortalUpdateWidgetNodeFromElement, args: {
  node: Konva.Group;
  width: number;
  height: number;
  expanded: boolean;
  label: string;
  labelFill: string;
  hostColors?: THostThemeColors;
}) {
  const bodyHeight = Math.max(WIDGET_HOST_MIN_BODY_HEIGHT, args.height - WIDGET_HOST_HEADER_HEIGHT);
  const height = Math.max(WIDGET_HOST_MIN_HEIGHT, WIDGET_HOST_HEADER_HEIGHT + bodyHeight);
  const width = Math.max(WIDGET_HOST_MIN_WIDTH, args.width);

  args.node.width(width);
  args.node.height(height);
  args.node.scale({ x: 1, y: 1 });

  const border = args.node.findOne(`#${WIDGET_HOST_BORDER_ID}`);
  if (border instanceof portal.Rect) {
    border.width(width);
    border.height(args.expanded ? height : WIDGET_HOST_HEADER_HEIGHT);
    if (args.hostColors) {
      border.stroke(args.hostColors.windowStroke);
    }
  }

  const header = args.node.getChildren().find((child) => {
    return child instanceof portal.Group && child.id() === WIDGET_HOST_HEADER_ID;
  });
  if (header instanceof portal.Group) {
    const headerBackground = header.findOne(`#${WIDGET_HOST_HEADER_ID}`);
    if (headerBackground instanceof portal.Rect) {
      headerBackground.width(width);
      headerBackground.cornerRadius([WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0]);
      if (args.hostColors) {
        headerBackground.fill(args.hostColors.headerFill);
      }
    }

    const title = header.findOne(`#${WIDGET_HOST_TITLE_ID}`);
    if (portal.Text && title instanceof portal.Text) {
      const menuButtonX = getMenuButtonX(width);
      title.text(args.label);
      title.fill(args.labelFill);
      title.width(getTitleWidth({ titleX: title.x(), menuButtonX }));
    } else if (portal.Text) {
      const titleX = 58;
      const menuButtonX = getMenuButtonX(width);
      header.add(new portal.Text({
        id: WIDGET_HOST_TITLE_ID,
        x: titleX,
        y: 0,
        width: getTitleWidth({ titleX, menuButtonX }),
        height: WIDGET_HOST_HEADER_HEIGHT,
        text: args.label,
        fill: args.labelFill,
        fontSize: 12,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        fontStyle: 'bold',
        align: 'left',
        verticalAlign: 'middle',
        ellipsis: true,
        listening: false,
      }));
    }

    txEnsureMenuButton(portal, {
      header,
      width,
      labelFill: args.labelFill,
    });
  }

  const divider = args.node.findOne(`#${WIDGET_HOST_DIVIDER_ID}`);
  if (divider instanceof portal.Rect) {
    divider.width(Math.max(0, width - WIDGET_HOST_WINDOW_STROKE_WIDTH * 2));
    divider.visible(args.expanded);
    divider.listening(false);
    if (args.hostColors) {
      divider.fill(args.hostColors.dividerFill);
    }
  }

  const body = args.node.findOne(`#${WIDGET_HOST_BODY_ID}`);
  if (body instanceof portal.Rect) {
    body.y(WIDGET_HOST_HEADER_HEIGHT);
    body.width(width);
    body.height(bodyHeight);
    body.visible(args.expanded);
    body.listening(args.expanded);
    if (args.hostColors) {
      body.fill(args.hostColors.bodyFill);
    }
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
    label: args.label ?? args.element.data.kind,
    labelFill: args.labelFill ?? args.hostColors?.headerTitleFill ?? '#ef4444',
    hostColors: args.hostColors,
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
