import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from 'konva';
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_CLOSE_BUTTON_ID,
  WIDGET_HOST_DIVIDER_HEIGHT,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_TITLE_ID,
  WIDGET_HOST_MIN_BODY_HEIGHT,
  WIDGET_HOST_MIN_HEIGHT,
  WIDGET_HOST_MAXIMIZE_BUTTON_ID,
  WIDGET_HOST_MINIMIZE_BUTTON_ID,
  WIDGET_HOST_MIN_WIDTH,
  WIDGET_HOST_TRAFFIC_LIGHT_RADIUS,
  WIDGET_HOST_TRAFFIC_LIGHT_SPACING,
  WIDGET_HOST_TRAFFIC_LIGHT_START_X,
  WIDGET_HOST_TRAFFIC_LIGHT_Y,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
  WIDGET_HOST_WINDOW_STROKE_WIDTH,
} from './CONSTANTS';
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR } from "../../core/CONSTANTS"
import type { THostThemeColors } from "./types";


function createHeader(konva: typeof Konva, colors: THostThemeColors, label: string) {

  const header = new konva.Rect({
    id: WIDGET_HOST_HEADER_ID,
    x: 0,
    y: 0,
    width: WIDGET_HOST_MIN_WIDTH,
    height: WIDGET_HOST_HEADER_HEIGHT,
    fill: colors.headerFill,
    cornerRadius: [WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0],
  })

  const divider = new konva.Rect({
    id: WIDGET_HOST_DIVIDER_ID,
    x: WIDGET_HOST_WINDOW_STROKE_WIDTH,
    y: WIDGET_HOST_HEADER_HEIGHT - WIDGET_HOST_DIVIDER_HEIGHT,
    width: WIDGET_HOST_MIN_WIDTH - WIDGET_HOST_WINDOW_STROKE_WIDTH * 2,
    height: WIDGET_HOST_DIVIDER_HEIGHT,
    fill: colors.dividerFill,
  })

  const closeButton = new konva.Circle({
    id: WIDGET_HOST_CLOSE_BUTTON_ID,
    x: WIDGET_HOST_TRAFFIC_LIGHT_START_X,
    y: WIDGET_HOST_TRAFFIC_LIGHT_Y,
    radius: WIDGET_HOST_TRAFFIC_LIGHT_RADIUS,
    fill: colors.closeButtonFill,
    stroke: colors.trafficLightStroke,
    strokeWidth: 1,
  })

  const minimizeButton = new konva.Circle({
    id: WIDGET_HOST_MINIMIZE_BUTTON_ID,
    x: WIDGET_HOST_TRAFFIC_LIGHT_START_X + WIDGET_HOST_TRAFFIC_LIGHT_SPACING,
    y: WIDGET_HOST_TRAFFIC_LIGHT_Y,
    radius: WIDGET_HOST_TRAFFIC_LIGHT_RADIUS,
    fill: colors.minimizeButtonFill,
    stroke: colors.trafficLightStroke,
    strokeWidth: 1,
  })

  const maximizeButton = new konva.Circle({
    id: WIDGET_HOST_MAXIMIZE_BUTTON_ID,
    x: WIDGET_HOST_TRAFFIC_LIGHT_START_X + WIDGET_HOST_TRAFFIC_LIGHT_SPACING * 2,
    y: WIDGET_HOST_TRAFFIC_LIGHT_Y,
    radius: WIDGET_HOST_TRAFFIC_LIGHT_RADIUS,
    fill: colors.maximizeButtonFill,
    stroke: colors.trafficLightStroke,
    strokeWidth: 1,
  })

  const title = new konva.Text({
    id: WIDGET_HOST_TITLE_ID,
    x: WIDGET_HOST_TRAFFIC_LIGHT_START_X + WIDGET_HOST_TRAFFIC_LIGHT_SPACING * 3,
    y: 0,
    width: WIDGET_HOST_MIN_WIDTH - (WIDGET_HOST_TRAFFIC_LIGHT_START_X + WIDGET_HOST_TRAFFIC_LIGHT_SPACING * 3) - 8,
    height: WIDGET_HOST_HEADER_HEIGHT,
    text: label,
    fill: colors.headerTitleFill,
    fontSize: 12,
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontStyle: 'bold',
    align: 'left',
    verticalAlign: 'middle',
    ellipsis: true,
    listening: false,
  })


  const headerGroup = new konva.Group({
    id: `${WIDGET_HOST_HEADER_ID}`,
  })
  headerGroup.add(header)
  headerGroup.add(divider)
  headerGroup.add(closeButton)
  headerGroup.add(minimizeButton)
  headerGroup.add(maximizeButton)
  headerGroup.add(title)

  return headerGroup
}

function createBorder(konva: typeof Konva, colors: THostThemeColors) {
  const border = new konva.Rect({
    id: WIDGET_HOST_BORDER_ID,
    x: 0,
    y: 0,
    width: WIDGET_HOST_MIN_WIDTH,
    height: WIDGET_HOST_HEADER_HEIGHT,
    stroke: colors.windowStroke,
    strokeWidth: WIDGET_HOST_WINDOW_STROKE_WIDTH,
    cornerRadius: [WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0],
  })

  return border
}

function createBody(konva: typeof Konva, colors: THostThemeColors) {
  const body = new konva.Rect({
    id: WIDGET_HOST_BODY_ID,
    x: 0,
    y: WIDGET_HOST_HEADER_HEIGHT,
    width: WIDGET_HOST_MIN_WIDTH,
    height: 0,
    fill: colors.bodyFill,
    cornerRadius: 0,
  })

  return body;
}

export function fnCreateWidgetNode(konva: typeof Konva, colors: THostThemeColors, element: TElement, args?: { label?: string }) {
  if (element.data.type !== 'widget' && element.data.type !== 'ui-widget') return null

  const width = Math.max(WIDGET_HOST_MIN_WIDTH, element.data.w)
  const height = Math.max(WIDGET_HOST_MIN_HEIGHT, element.data.h)
  const bodyHeight = Math.max(0, height - WIDGET_HOST_HEADER_HEIGHT)
  const dividerWidth = Math.max(0, width - WIDGET_HOST_WINDOW_STROKE_WIDTH * 2)
  const isExpanded = element.data.expanded !== false

  const group = new konva.Group({
    id: element.id,
    x: element.x,
    y: element.y,
    width,
    height,
  })
  const body = createBody(konva, colors)
  body.width(width)
  body.height(Math.max(WIDGET_HOST_MIN_BODY_HEIGHT, bodyHeight))
  body.visible(isExpanded)
  body.listening(isExpanded)

  const header = createHeader(konva, colors, args?.label ?? element.data.kind)
  const border = createBorder(konva, colors)
  const headerBackground = header.findOne(`#${WIDGET_HOST_HEADER_ID}`)
  const divider = header.findOne(`#${WIDGET_HOST_DIVIDER_ID}`)
  const title = header.findOne(`#${WIDGET_HOST_TITLE_ID}`)

  if (border) {
    border.width(width)
    border.height(isExpanded ? height : WIDGET_HOST_MIN_HEIGHT)
  }

  if (headerBackground instanceof konva.Rect) {
    headerBackground.width(width)
    headerBackground.height(WIDGET_HOST_HEADER_HEIGHT)
    headerBackground.cornerRadius([WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0])
  }

  if (divider instanceof konva.Rect) {
    divider.width(dividerWidth)
    divider.visible(isExpanded)
    divider.listening(false)
  }

  if (title instanceof konva.Text) {
    title.width(Math.max(0, width - title.x() - 8))
  }

  group.add(border)
  group.add(header)
  group.add(body)

  group.setAttr(ELEMENT_DATA_ATTR, {
    ...element.data,
    w: width,
    h: height,
    expanded: isExpanded,
  })
  group.setAttr(ELEMENT_STYLE_ATTR, element.style ?? {})
  group.setAttr(VC_CREATED_AT_ATTR, element.createdAt)
  group.setAttr(VC_UPDATED_AT_ATTR, element.updatedAt)

  return group
}
