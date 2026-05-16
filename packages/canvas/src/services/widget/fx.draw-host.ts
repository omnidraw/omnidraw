import type { TElement, TElementData, TUiWidgetData, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types'
import type { ThemeService } from '@vibecanvas/service-theme'
import type Konva from 'konva'
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS"
import {
    WIDGET_HOST_BODY_ID,
    WIDGET_HOST_BORDER_ID,
    WIDGET_HOST_CLOSE_BUTTON_ID,
    WIDGET_HOST_DIVIDER_HEIGHT,
    WIDGET_HOST_DIVIDER_ID,
    WIDGET_HOST_HEADER_HEIGHT,
    WIDGET_HOST_HEADER_ID,
    WIDGET_HOST_MAXIMIZE_BUTTON_ID,
    WIDGET_HOST_MIN_BODY_HEIGHT,
    WIDGET_HOST_MIN_HEIGHT,
    WIDGET_HOST_MINIMIZE_BUTTON_ID,
    WIDGET_HOST_MIN_WIDTH,
    WIDGET_HOST_WINDOW_STROKE_WIDTH
} from './CONSTANTS'

import { fnCreateWidgetNode } from './fn.create-widget-node'
import type { TToolCanvasPoint, TToolDrawCreateStartDraftArgs } from '../tool/types'
import type { IWidgetConfig } from './interface'

type THostThemeColors = {
  headerFill: string;
  bodyFill: string;
  dividerFill: string;
  windowStroke: string;
  trafficLightStroke: string;
  closeButtonFill: string;
  minimizeButtonFill: string;
  maximizeButtonFill: string;
}

function getHostThemeColors(themeService: ThemeService): THostThemeColors {
  const colors = themeService.getTheme().colors

  return {
    headerFill: colors.muted,
    bodyFill: colors.card,
    dividerFill: colors.border,
    windowStroke: colors.border,
    trafficLightStroke: colors.border,
    closeButtonFill: colors.destructive,
    minimizeButtonFill: colors.warning,
    maximizeButtonFill: colors.success,
  }
}

type TPortalUpdateHost = {
  konva: typeof Konva;
  group: Konva.Group;
  themeService: ThemeService;
}

type TArgsUpdateHost = {
  point: TToolCanvasPoint
}

export function fxUpdateHost(portal: TPortalUpdateHost, args: TArgsUpdateHost) {
  const border = portal.group.findOne(`#${WIDGET_HOST_BORDER_ID}`)
  const header = portal.group.getChildren().find((child) => {
    return child instanceof portal.konva.Group && child.id() === WIDGET_HOST_HEADER_ID
  })
  const body = portal.group.findOne(`#${WIDGET_HOST_BODY_ID}`)
  const divider = portal.group.findOne(`#${WIDGET_HOST_DIVIDER_ID}`)
  const closeButton = portal.group.findOne(`#${WIDGET_HOST_CLOSE_BUTTON_ID}`)
  const minimizeButton = portal.group.findOne(`#${WIDGET_HOST_MINIMIZE_BUTTON_ID}`)
  const maximizeButton = portal.group.findOne(`#${WIDGET_HOST_MAXIMIZE_BUTTON_ID}`)
  if (!(body instanceof portal.konva.Rect)) return
  if (!(header instanceof portal.konva.Group)) return

  const hostThemeColors = getHostThemeColors(portal.themeService)
  const width = Math.max(WIDGET_HOST_MIN_WIDTH, args.point.x - portal.group.x())
  const height = Math.max(WIDGET_HOST_MIN_HEIGHT, args.point.y - portal.group.y())
  const bodyHeight = Math.max(WIDGET_HOST_MIN_BODY_HEIGHT, height - WIDGET_HOST_HEADER_HEIGHT)
  const dividerWidth = Math.max(0, width - WIDGET_HOST_WINDOW_STROKE_WIDTH * 2)

  portal.group.width(width)
  portal.group.height(WIDGET_HOST_HEADER_HEIGHT + bodyHeight)

  if (border instanceof portal.konva.Rect) {
    border.width(width)
    border.height(WIDGET_HOST_HEADER_HEIGHT + bodyHeight)
    border.stroke(hostThemeColors.windowStroke)
  }

  const headerBackground = header.findOne(`#${WIDGET_HOST_HEADER_ID}`)
  if (!(headerBackground instanceof portal.konva.Rect)) return

  headerBackground.width(width)
  headerBackground.height(WIDGET_HOST_HEADER_HEIGHT)
  headerBackground.fill(hostThemeColors.headerFill)

  if (divider instanceof portal.konva.Rect) {
    divider.x(WIDGET_HOST_WINDOW_STROKE_WIDTH)
    divider.y(WIDGET_HOST_HEADER_HEIGHT - WIDGET_HOST_DIVIDER_HEIGHT)
    divider.width(dividerWidth)
    divider.height(WIDGET_HOST_DIVIDER_HEIGHT)
    divider.fill(hostThemeColors.dividerFill)
    divider.visible(true)
    divider.listening(false)
  }

  body.y(WIDGET_HOST_HEADER_HEIGHT)
  body.width(width)
  body.height(bodyHeight)
  body.fill(hostThemeColors.bodyFill)
  body.visible(true)
  body.listening(true)

  const widgetData = portal.group.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined
  if (widgetData?.type === 'widget' || widgetData?.type === 'ui-widget') {
    widgetData.w = width
    widgetData.h = WIDGET_HOST_HEADER_HEIGHT + bodyHeight
    widgetData.expanded = true
    portal.group.setAttr(ELEMENT_DATA_ATTR, widgetData)
  }

  if (closeButton instanceof portal.konva.Circle) {
    closeButton.fill(hostThemeColors.closeButtonFill)
    closeButton.stroke(hostThemeColors.trafficLightStroke)
  }

  if (minimizeButton instanceof portal.konva.Circle) {
    minimizeButton.fill(hostThemeColors.minimizeButtonFill)
    minimizeButton.stroke(hostThemeColors.trafficLightStroke)
  }

  if (maximizeButton instanceof portal.konva.Circle) {
    maximizeButton.fill(hostThemeColors.maximizeButtonFill)
    maximizeButton.stroke(hostThemeColors.trafficLightStroke)
  }
}

type TPortalCreateHost = {
  konva: typeof Konva;
  themeService: ThemeService;
  crypto: typeof crypto;
}

type TArgsCreateHost = { widgetConfig: IWidgetConfig } & TToolDrawCreateStartDraftArgs

function createWidgetElementData(args: { widgetConfig: IWidgetConfig }): TElementData {
  const widgetType = args.widgetConfig.dataType ?? 'ui-widget'

  if (widgetType === 'widget') {
    const actor = args.widgetConfig.actor
    if (!actor) {
      throw new Error('Actor widget config requires actor metadata')
    }

    return {
      type: 'widget',
      expanded: true,
      kind: args.widgetConfig.id,
      window: 'contained',
      h: WIDGET_HOST_MIN_HEIGHT,
      w: WIDGET_HOST_MIN_WIDTH,
      actorDefinitionId: actor.actorDefinitionId,
      actorRevisionId: actor.actorRevisionId,
      actorSlug: actor.actorSlug,
      actorName: actor.actorName,
      actorVersion: actor.actorVersion,
      uiKind: actor.uiKind ?? args.widgetConfig.id,
      uiBundleFileId: actor.uiBundleFileId,
      uiManifest: actor.uiManifest,
      initialActorInput: actor.initialActorInput,
      uiProps: actor.uiProps,
    }
  }

  return {
    type: 'ui-widget',
    expanded: true,
    kind: args.widgetConfig.id,
    window: 'contained',
    h: WIDGET_HOST_MIN_HEIGHT,
    w: WIDGET_HOST_MIN_WIDTH,
    payload: args.widgetConfig.initialPayload ?? {},
  }
}

export function fxDrawHost(portal: TPortalCreateHost, args: TArgsCreateHost) {
  const hostThemeColors = getHostThemeColors(portal.themeService)

  const elementData = createWidgetElementData({ widgetConfig: args.widgetConfig })

  const element: TElement = {
    id: portal.crypto.randomUUID(),
    x: args.point.x,
    y: args.point.y,
    rotation: 0,
    zIndex: '',
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: elementData,
    style: {}
  }

  const group = fnCreateWidgetNode(portal.konva, hostThemeColors, element)

  return group
}
