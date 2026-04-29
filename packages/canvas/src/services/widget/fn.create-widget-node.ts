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
  WIDGET_CONNECTION_BOUNDARY_ID,
  WIDGET_CONNECTION_BOUNDARY_OFFSET,
  WIDGET_CONNECTION_HANDLE_ID,
} from './CONSTANTS';
import { ELEMENT_DATA_ATTR, ELEMENT_STYLE_ATTR, VC_CREATED_AT_ATTR, VC_UPDATED_AT_ATTR } from "../../core/CONSTANTS"
import type { THostThemeColors } from "./types";


function createHeader(konva: typeof Konva, colors: THostThemeColors) {

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


  const headerGroup = new konva.Group({
    id: `${WIDGET_HOST_HEADER_ID}`,
  })
  headerGroup.add(header)
  headerGroup.add(divider)
  headerGroup.add(closeButton)
  headerGroup.add(minimizeButton)
  headerGroup.add(maximizeButton)

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

function createConnectionBorder(konva: typeof Konva, colors: THostThemeColors) {
  const border = new konva.Line({
    id: WIDGET_CONNECTION_BOUNDARY_ID,
    points: [],
    closed: true,
    stroke: colors.windowStroke,
    strokeWidth: 2,
    lineJoin: 'round',
    lineCap: 'round',
    fillEnabled: false,
    listening: true,
    hitStrokeWidth: 32,
    dash: [6, 5],
    opacity: 0.8,
  })

  return border;
}

function createConnectionHandle(konva: typeof Konva) {
  return new konva.Circle({
    id: WIDGET_CONNECTION_HANDLE_ID,
    x: 0,
    y: 0,
    radius: 10,
    fill: '#38bdf8',
    stroke: '#e0f2fe',
    strokeWidth: 3,
    shadowColor: '#38bdf8',
    shadowBlur: 14,
    shadowOpacity: 0.65,
    visible: false,
    listening: false,
    hitStrokeWidth: 24,
    opacity: 0.95,
  })
}

function syncConnectionBorder(border: Konva.Line, args: { width: number; height: number }) {
  const offset = WIDGET_CONNECTION_BOUNDARY_OFFSET
  const radius = 18
  const left = -offset
  const top = -offset
  const right = args.width + offset
  const bottom = args.height + offset
  const corner = Math.min(radius, (right - left) / 2, (bottom - top) / 2)
  const segments = 8
  const points: number[] = []

  const addArc = (centerX: number, centerY: number, startAngle: number, endAngle: number) => {
    for (let index = 0; index <= segments; index += 1) {
      const amount = index / segments
      const angle = startAngle + (endAngle - startAngle) * amount
      points.push(centerX + Math.cos(angle) * corner, centerY + Math.sin(angle) * corner)
    }
  }

  addArc(right - corner, top + corner, -Math.PI / 2, 0)
  addArc(right - corner, bottom - corner, 0, Math.PI / 2)
  addArc(left + corner, bottom - corner, Math.PI / 2, Math.PI)
  addArc(left + corner, top + corner, Math.PI, Math.PI * 1.5)

  border.points(points)
}

export function fnCreateWidgetNode(konva: typeof Konva, colors: THostThemeColors, element: TElement) {
  if (element.data.type !== 'widget') return null

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
  const connectionBorder = createConnectionBorder(konva, colors)
  syncConnectionBorder(connectionBorder, { width, height })
  const connectionHandle = createConnectionHandle(konva)

  const body = createBody(konva, colors)
  body.width(width)
  body.height(Math.max(WIDGET_HOST_MIN_BODY_HEIGHT, bodyHeight))
  body.visible(isExpanded)
  body.listening(isExpanded)

  const header = createHeader(konva, colors)
  const border = createBorder(konva, colors)
  const headerBackground = header.findOne(`#${WIDGET_HOST_HEADER_ID}`)
  const divider = header.findOne(`#${WIDGET_HOST_DIVIDER_ID}`)

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

  group.add(connectionBorder)
  group.add(connectionHandle)
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
