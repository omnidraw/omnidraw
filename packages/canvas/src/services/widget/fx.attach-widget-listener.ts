import type { TElement, TUiWidgetData, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types'
import { fnCurry } from '@vibecanvas/shared-functions/functional/fn.curry'
import type Konva from 'konva'
import type { CrdtService } from '..'
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS"
import type { IRuntimeHooks, TElementPointerEvent } from '../../types'
import type { SelectionService } from '../selection/SelectionService'
import {
  WIDGET_DOM_PORTAL_SYNC_ATTR,
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_CLOSE_BUTTON_ID,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_MAXIMIZE_BUTTON_ID,
  WIDGET_HOST_MENU_BUTTON_HIT_ID,
  WIDGET_HOST_MENU_BUTTON_ID,
  WIDGET_HOST_MINIMIZE_BUTTON_ID,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
  WIDGET_WINDOW_CONTAINED,
  WIDGET_WINDOW_FULLSCREEN,
} from './CONSTANTS'

type TPortal = {
  Circle: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  Rect: typeof Konva.Rect;
  hooks: IRuntimeHooks;
  node: Konva.Node;
  selection: SelectionService;
  toElement: (node: Konva.Node) => TElement | null;
  crdtService: CrdtService;
  startDragClone?: (args: {
    node: Konva.Node;
    selection: Konva.Node[];
  }) => boolean;
  removeWidget?: (node: Konva.Group) => boolean;
  openWidgetMenu?: (args: {
    node: Konva.Group;
    anchor: {
      x: number;
      y: number;
    };
  }) => void;
  closeWidgetMenu?: () => void;
  setTimer?: (callback: () => void, timeout: number) => unknown;
  clearTimer?: (timer: unknown) => void;
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
  removeWidget?: (node: Konva.Group) => boolean;
  syncExpandedState: (expanded: boolean) => void;
  syncWindowState: (windowMode: typeof WIDGET_WINDOW_CONTAINED | typeof WIDGET_WINDOW_FULLSCREEN) => void;
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
      if (buttonId === WIDGET_HOST_CLOSE_BUTTON_ID) {
        args.removeWidget?.(args.node)
        return
      }
      if (buttonId === WIDGET_HOST_MINIMIZE_BUTTON_ID) {
        const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined
        const nextExpanded = widgetData?.type === 'widget' || widgetData?.type === 'ui-widget'
          ? widgetData.expanded === false
          : false
        args.syncExpandedState(nextExpanded)
      }
      if (buttonId === WIDGET_HOST_MAXIMIZE_BUTTON_ID) {
        const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined
        const nextWindowMode = (widgetData?.type === 'widget' || widgetData?.type === 'ui-widget') && widgetData.window === WIDGET_WINDOW_FULLSCREEN
          ? WIDGET_WINDOW_CONTAINED
          : WIDGET_WINDOW_FULLSCREEN
        args.syncWindowState(nextWindowMode)
      }
    })
  })
}

function setupMenuButton(args: {
  Group: typeof Konva.Group;
  Rect: typeof Konva.Rect;
  node: Konva.Group;
  setCursor: (cursor: string) => void;
  openWidgetMenu?: TPortal["openWidgetMenu"];
}) {
  const menuButton = args.node.findOne(`#${WIDGET_HOST_MENU_BUTTON_ID}`)
  if (!(menuButton instanceof args.Group)) {
    return
  }

  const hit = menuButton.findOne(`#${WIDGET_HOST_MENU_BUTTON_HIT_ID}`)
  const setHover = (hovered: boolean) => {
    if (hit instanceof args.Rect) {
      hit.opacity(hovered ? 0.12 : 0)
      hit.getLayer()?.batchDraw()
    }
  }

  menuButton.off('pointerover pointerout pointerdown pointerup pointerclick')
  menuButton.on('pointerover', (event) => {
    event.cancelBubble = true
    setHover(true)
    args.setCursor('pointer')
  })
  menuButton.on('pointerout', (event) => {
    event.cancelBubble = true
    setHover(false)
    args.setCursor('default')
  })
  menuButton.on('pointerdown pointerup', (event) => {
    event.cancelBubble = true
    args.setCursor('pointer')
  })
  menuButton.on('pointerclick', (event) => {
    event.cancelBubble = true
    setHover(false)
    args.setCursor('pointer')

    const stage = args.node.getStage()
    if (!stage) {
      return
    }

    const containerRect = stage.container().getBoundingClientRect()
    const buttonRect = menuButton.getClientRect()
    args.openWidgetMenu?.({
      node: args.node,
      anchor: {
        x: containerRect.left + buttonRect.x + buttonRect.width,
        y: containerRect.top + buttonRect.y + buttonRect.height,
      },
    })
  })
}

function syncWidgetDomPortal(portal: TPortal) {
  const syncWidgetDomPortal = portal.node.getAttr(WIDGET_DOM_PORTAL_SYNC_ATTR) as (() => void) | undefined
  syncWidgetDomPortal?.()
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

  const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined
  if (widgetData?.type === 'widget' || widgetData?.type === 'ui-widget') {
    portal.node.setAttr(ELEMENT_DATA_ATTR, {
      ...widgetData,
      expanded,
    })
  }

  syncWidgetDomPortal(portal)
  portal.node.getLayer()?.batchDraw()
}

function syncWindowState(portal: TPortal, windowMode: typeof WIDGET_WINDOW_CONTAINED | typeof WIDGET_WINDOW_FULLSCREEN) {
  if (!(portal.node instanceof portal.Group)) return

  if (windowMode === WIDGET_WINDOW_FULLSCREEN) {
    activateWidgetBody(portal)
  }

  const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TUiWidgetData | TWidgetData | undefined
  if (widgetData?.type === 'widget' || widgetData?.type === 'ui-widget') {
    portal.node.setAttr(ELEMENT_DATA_ATTR, {
      ...widgetData,
      window: windowMode,
    })
  }

  syncWidgetDomPortal(portal)
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

type TKonvaTargetWithId = {
  id: () => string;
}

function getKonvaTargetId(target: unknown) {
  if (!target || typeof (target as TKonvaTargetWithId).id !== 'function') {
    return null
  }

  return (target as TKonvaTargetWithId).id()
}

function isWidgetBodyTarget(target: unknown) {
  return getKonvaTargetId(target) === WIDGET_HOST_BODY_ID
}

function activateWidgetBody(portal: TPortal) {
  if (portal.selection.selection.length > 0) {
    portal.selection.setSelection([])
  }

  if (portal.selection.focusedId !== portal.node.id()) {
    portal.selection.setFocusedId(portal.node.id())
  }
}

function deactivateWidgetBodyAfterHostSelection(portal: TPortal) {
  if (portal.selection.focusedId === portal.node.id()) {
    portal.selection.setFocusedId(null)
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

    if (isWidgetBodyTarget(event.target)) {
      event.cancelBubble = true
      return
    }

    portal.hooks.elementPointerClick.call(event as TElementPointerEvent);
  });

  portal.node.on("pointerdown dragstart", (event) => {
    if (portal.selection.mode !== "select") {
      safeStopDrag(portal.node);
      return;
    }

    if (event.type === "pointerdown") {
      if (isWidgetBodyTarget(event.target)) {
        activateWidgetBody(portal)
        event.cancelBubble = true
        return
      }

      const earlyExit = portal.hooks.elementPointerDown.call(event as TElementPointerEvent);
      deactivateWidgetBodyAfterHostSelection(portal)
      if (earlyExit) {
        event.cancelBubble = true;
      }
      return;
    }

    if (event.evt?.altKey) {
      safeStopDrag(portal.node);
      portal.startDragClone?.({
        node: portal.node,
        selection: portal.selection.selection,
      });
    }
  });

  portal.node.on("pointerdblclick", (event) => {
    if (portal.selection.mode !== "select") {
      return;
    }

    if (isWidgetBodyTarget(event.target)) {
      event.cancelBubble = true
      return
    }

    const earlyExit = portal.hooks.elementPointerDoubleClick.call(event as TElementPointerEvent);
    deactivateWidgetBodyAfterHostSelection(portal)
    if (earlyExit) {
      event.cancelBubble = true;
    }
  });

  portal.node.draggable(true)
  portal.node.listening(true)
  return true
}

function setupDragListener(portal: TPortal) {
  if (!(portal.node instanceof portal.Group)) return false
  const widgetNode = portal.node

  widgetNode.off('dragmove.widgetListener dragend.widgetListener')
  widgetNode.on('dragmove.widgetListener', () => {
    portal.closeWidgetMenu?.()
  })

  widgetNode.on('dragend.widgetListener', () => {
    portal.crdtService.build()
      .patchElement(widgetNode.id(), 'x', widgetNode.x())
      .patchElement(widgetNode.id(), 'y', widgetNode.y())
      .commit()
  })

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
  const header = portal.node.findOne('#' + WIDGET_HOST_HEADER_ID)

  const didAttachSelectable = setupSelectable(portal)
  setupButtons({
    Circle: portal.Circle,
    Rect: portal.Rect,
    node: portal.node,
    setCursor,
    removeWidget: portal.removeWidget,
    syncExpandedState: fnCurry(syncExpandedState)(portal),
    syncWindowState: fnCurry(syncWindowState)(portal),
  })
  setupMenuButton({
    Group: portal.Group,
    Rect: portal.Rect,
    node: portal.node,
    setCursor,
    openWidgetMenu: portal.openWidgetMenu,
  })
  if(header) setupCursor(setCursor, portal.node, header)
  setupDragListener(portal)

  return didAttachSelectable
}
