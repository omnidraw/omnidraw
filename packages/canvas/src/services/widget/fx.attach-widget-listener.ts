import type { TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types'
import type Konva from 'konva'
import { fnCurry } from '@vibecanvas/shared-functions/functional/fn.curry'
import type { IRuntimeHooks, TElementPointerEvent } from '../../types'
import {
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_CLOSE_BUTTON_ID,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_MAXIMIZE_BUTTON_ID,
  WIDGET_HOST_MINIMIZE_BUTTON_ID,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
} from './CONSTANTS'
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS"
import type { SelectionService } from '../selection/SelectionService'

type TPortal = {
  Circle: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Rect: typeof Konva.Rect;
  hooks: IRuntimeHooks;
  node: Konva.Node;
  selection: SelectionService;
  // startDragClone: (args: {
  //   node: Konva.Node;
  //   selection: Konva.Node[];
  // }) => boolean;
}
type TArgs = {
}

function toHoverFill(fill: string | CanvasGradient) {
  return `${fill}cc`
}

function setupButtons(args: {
  Circle: typeof Konva.Circle;
  Rect: typeof Konva.Rect;
  node: Konva.Group;
  setCursor: (cursor: string) => void;
  syncExpandedState: (expanded: boolean) => void;
}) {
  const buttonIds = [
    WIDGET_HOST_CLOSE_BUTTON_ID,
    WIDGET_HOST_MINIMIZE_BUTTON_ID,
    WIDGET_HOST_MAXIMIZE_BUTTON_ID,
  ]

  buttonIds.forEach((buttonId) => {
    const button = args.node.findOne(`#${buttonId}`)
    if (!(button instanceof args.Circle)) {
      return
    }

    const baseFill = button.fill()
    const hoverFill = toHoverFill(baseFill)

    button.off('pointerover pointerout pointerdown pointerup pointerclick')
    button.on('pointerover', (event) => {
      event.cancelBubble = true
      button.fill(hoverFill)
      args.setCursor('pointer')
      button.getLayer()?.batchDraw()
    })
    button.on('pointerout', (event) => {
      event.cancelBubble = true
      button.fill(baseFill)
      args.setCursor('default')
      button.getLayer()?.batchDraw()
    })
    button.on('pointerdown pointerup', (event) => {
      event.cancelBubble = true
      args.setCursor('pointer')
    })
    button.on('pointerclick', (event) => {
      event.cancelBubble = true
      args.setCursor('pointer')
      if (buttonId === WIDGET_HOST_MINIMIZE_BUTTON_ID) {
        const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined
        const nextExpanded = widgetData?.type === 'widget'
          ? widgetData.expanded === false
          : false
        args.syncExpandedState(nextExpanded)
      }
    })
  })
}

function syncExpandedState(portal: TPortal, expanded: boolean) {
  if (!(portal.node instanceof portal.Group)) return
  const body = portal.node.findOne(`#${WIDGET_HOST_BODY_ID}`)
  if (body instanceof portal.Rect) {
    body.visible(expanded)
    body.listening(expanded)
  }

  const border = portal.node.findOne(`#${WIDGET_HOST_BORDER_ID}`)
  if (border instanceof portal.Rect) {
    border.height(expanded ? portal.node.height() : WIDGET_HOST_HEADER_HEIGHT)
  }

  const divider = portal.node.findOne(`#${WIDGET_HOST_DIVIDER_ID}`)
  if (divider instanceof portal.Rect) {
    divider.visible(expanded)
    divider.listening(false)
  }

  const header = portal.node.findOne(`#${WIDGET_HOST_HEADER_ID}`)
  if (header instanceof portal.Rect) {
    header.cornerRadius([WIDGET_HOST_WINDOW_CORNER_RADIUS, WIDGET_HOST_WINDOW_CORNER_RADIUS, 0, 0])
  }

  const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined
  if (widgetData?.type === 'widget') {
    portal.node.setAttr(ELEMENT_DATA_ATTR, {
      ...widgetData,
      expanded,
    } satisfies TWidgetData)
  }

  portal.node.getLayer()?.batchDraw()
}

function setupCursor(setCursor: (cursor: string) => void, group: Konva.Group, header: Konva.Node) {
  header.off('pointerover pointerout pointerdown pointerup dragstart dragend')
  header.on('pointerover', () => {
    setCursor('grab')
  })
  header.on('pointerout', () => {
    setCursor('default')
  })


  header.on('pointerdown dragstart', () => {
    setCursor('grabbing')
  })
  header.on('pointerup dragend', () => {
    setCursor('grab')
  })

  group.on('dragend', () => {
    setCursor('grab')
  })
}

function safeStopDrag(node: Konva.Node) {
  try {
    if (node.isDragging()) {
      node.stopDrag()
    }
  } catch {
    return
  }
}

function setupSelectable(portal: TPortal) {
  if (!(portal.node instanceof portal.Group)) {
    return false
  }

  portal.node.off('pointerclick pointerdown dragstart pointerdblclick')
  portal.node.on("pointerclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    portal.hooks.elementPointerClick.call(event as TElementPointerEvent);
  });

  portal.node.on("pointerdown dragstart", (event) => {
    if (portal.selection.mode !== "select") {
      safeStopDrag(portal.node);
      return;
    }

    if (event.type === "pointerdown") {
      const earlyExit = portal.hooks.elementPointerDown.call(event as TElementPointerEvent);
      if (earlyExit) {
        event.cancelBubble = true;
      }
      return;
    }

    if (event.evt?.altKey) {
      safeStopDrag(portal.node);
      // portal.startDragClone({
      //   node: portal.node,
      //   selection: portal.selection.selection,
      // });
    }
  });

  portal.node.on("pointerdblclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    const earlyExit = portal.hooks.elementPointerDoubleClick.call(event as TElementPointerEvent);
    if (earlyExit) {
      event.cancelBubble = true;
    }
  });

  portal.node.draggable(true)
  portal.node.listening(true)
  return true
}

export function fxAttachWidgetListener(portal: TPortal, args: TArgs) {
  if (!(portal.node instanceof portal.Group)) return false

  const setCursor = (cursor: string) => {
    const stage = portal.node.getStage()
    if (stage) {
      stage.container().style.cursor = cursor
    }
  }
  const header = portal.node.findOne('#header')

  const didAttachSelectable = setupSelectable(portal)
  setupButtons({
    Circle: portal.Circle,
    Rect: portal.Rect,
    node: portal.node,
    setCursor,
    syncExpandedState: fnCurry(syncExpandedState)(portal),
  })
  if(header) setupCursor(setCursor, portal.node, header)
  return didAttachSelectable
}
