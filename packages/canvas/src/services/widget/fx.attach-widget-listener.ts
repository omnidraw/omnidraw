import type { TElement, TWidgetData } from '@vibecanvas/service-automerge/types/canvas-doc.types'
import { fnCurry } from '@vibecanvas/shared-functions/functional/fn.curry'
import type Konva from 'konva'
import type { CrdtService } from '..'
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS"
import type { IRuntimeHooks, TElementPointerEvent } from '../../types'
import type { SelectionService } from '../selection/SelectionService'
import {
  WIDGET_DOM_PORTAL_SYNC_ATTR,
  WIDGET_CONNECTION_BOUNDARY_ID,
  WIDGET_CONNECTION_BOUNDARY_OFFSET,
  WIDGET_CONNECTION_HANDLE_ID,
  WIDGET_HOST_BODY_ID,
  WIDGET_HOST_BORDER_ID,
  WIDGET_HOST_CLOSE_BUTTON_ID,
  WIDGET_HOST_DIVIDER_ID,
  WIDGET_HOST_HEADER_HEIGHT,
  WIDGET_HOST_HEADER_ID,
  WIDGET_HOST_MAXIMIZE_BUTTON_ID,
  WIDGET_HOST_MINIMIZE_BUTTON_ID,
  WIDGET_HOST_WINDOW_CORNER_RADIUS,
  WIDGET_WINDOW_CONTAINED,
  WIDGET_WINDOW_FULLSCREEN,
} from './CONSTANTS'

type TWidgetConnectionSyncArgs = {
  scope?: "all" | "attached";
  syncHandles?: boolean;
}

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
  createConnectionId?: () => string;
  syncConnections?: (node: Konva.Group, args?: TWidgetConnectionSyncArgs) => void;
}
type TArgs = {
}

const WIDGET_CONNECTION_DRAG_ACTIVE_ATTR = '__widgetConnectionDragActive'
const WIDGET_CONNECTION_DRAG_UPDATE_ATTR = '__widgetConnectionDragUpdate'

type TConnectionDragUpdate = () => void

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
        const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined
        const nextExpanded = widgetData?.type === 'widget'
          ? widgetData.expanded === false
          : false
        args.syncExpandedState(nextExpanded)
      }
      if (buttonId === WIDGET_HOST_MAXIMIZE_BUTTON_ID) {
        const widgetData = args.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined
        const nextWindowMode = widgetData?.type === 'widget' && widgetData.window === WIDGET_WINDOW_FULLSCREEN
          ? WIDGET_WINDOW_CONTAINED
          : WIDGET_WINDOW_FULLSCREEN
        args.syncWindowState(nextWindowMode)
      }
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

  const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined
  if (widgetData?.type === 'widget') {
    portal.node.setAttr(ELEMENT_DATA_ATTR, {
      ...widgetData,
      expanded,
    } satisfies TWidgetData)
  }

  syncWidgetDomPortal(portal)
  portal.node.getLayer()?.batchDraw()
}

function syncWindowState(portal: TPortal, windowMode: typeof WIDGET_WINDOW_CONTAINED | typeof WIDGET_WINDOW_FULLSCREEN) {
  if (!(portal.node instanceof portal.Group)) return

  if (windowMode === WIDGET_WINDOW_FULLSCREEN) {
    activateWidgetBody(portal)
  }

  const widgetData = portal.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined
  if (widgetData?.type === 'widget') {
    portal.node.setAttr(ELEMENT_DATA_ATTR, {
      ...widgetData,
      window: windowMode,
    } satisfies TWidgetData)
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

function getConnectionArc(args: { x: number; y: number; width: number; height: number }) {
  const centerX = args.width / 2
  const centerY = args.height / 2
  const angle = Math.atan2(args.y - centerY, args.x - centerX)
  return (angle + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2)
}

function getConnectionBoundaryPoint(args: { arc: number; width: number; height: number }) {
  const left = -WIDGET_CONNECTION_BOUNDARY_OFFSET
  const top = -WIDGET_CONNECTION_BOUNDARY_OFFSET
  const right = args.width + WIDGET_CONNECTION_BOUNDARY_OFFSET
  const bottom = args.height + WIDGET_CONNECTION_BOUNDARY_OFFSET
  const centerX = args.width / 2
  const centerY = args.height / 2
  const angle = args.arc * Math.PI * 2
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const tx = dx > 0 ? (right - centerX) / dx : dx < 0 ? (left - centerX) / dx : Number.POSITIVE_INFINITY
  const ty = dy > 0 ? (bottom - centerY) / dy : dy < 0 ? (top - centerY) / dy : Number.POSITIVE_INFINITY
  const distance = Math.min(tx, ty)

  return {
    x: centerX + dx * distance,
    y: centerY + dy * distance,
  }
}

function getWidgetGroupFromNode(portal: TPortal, node: Konva.Node | null) {
  let current: Konva.Node | null = node
  while (current) {
    if (current instanceof portal.Group && current.getAttr(ELEMENT_DATA_ATTR)?.type === 'widget') {
      return current
    }
    current = current.getParent()
  }

  return null
}

function getArcForPointer(portal: TPortal, node: Konva.Group, pointer: { x: number; y: number }) {
  const transform = node.getAbsoluteTransform().copy().invert()
  const localPointer = transform.point(pointer)

  return getConnectionArc({
    x: localPointer.x,
    y: localPointer.y,
    width: node.width(),
    height: node.height(),
  })
}

function getBoundaryAbsolutePoint(node: Konva.Group, arc: number) {
  const point = getConnectionBoundaryPoint({
    arc,
    width: node.width(),
    height: node.height(),
  })

  return node.getAbsoluteTransform().point(point)
}

function toLayerPoint(layer: Konva.Layer | Konva.FastLayer, point: { x: number; y: number }) {
  return layer.getAbsoluteTransform().copy().invert().point(point)
}

function appendWidgetConnection(portal: TPortal, args: {
  source: Konva.Group;
  target: Konva.Group;
  sourceArc: number;
  targetArc: number;
}) {
  const sourceElement = portal.toElement(args.source)
  const targetElement = portal.toElement(args.target)
  if (!sourceElement || sourceElement.data.type !== 'widget') return false
  if (!targetElement || targetElement.data.type !== 'widget') return false

  const id = portal.createConnectionId?.() ?? `${args.source.id()}-${args.target.id()}-${args.sourceArc}-${args.targetArc}`
  const sourceData: TWidgetData = {
    ...sourceElement.data,
    connections: {
      inputs: sourceElement.data.connections?.inputs ?? [],
      outputs: [
        ...(sourceElement.data.connections?.outputs ?? []),
        {
          id,
          targetWidgetId: args.target.id(),
        },
      ],
    },
  }
  const targetData: TWidgetData = {
    ...targetElement.data,
    connections: {
      inputs: [
        ...(targetElement.data.connections?.inputs ?? []),
        {
          id,
          sourceWidgetId: args.source.id(),
          line: {
            sourceArc: args.sourceArc,
            targetArc: args.targetArc,
            waypoints: [],
          },
        },
      ],
      outputs: targetElement.data.connections?.outputs ?? [],
    },
  }

  args.source.setAttr(ELEMENT_DATA_ATTR, sourceData)
  args.target.setAttr(ELEMENT_DATA_ATTR, targetData)
  portal.crdtService.build()
    .patchElement(args.source.id(), 'data', sourceData)
    .patchElement(args.target.id(), 'data', targetData)
    .commit()

  portal.syncConnections?.(args.source)

  return true
}

function isConnectionDragActive(stage: Konva.Stage | null) {
  return stage?.getAttr(WIDGET_CONNECTION_DRAG_ACTIVE_ATTR) === true
}

function updateActiveConnectionDragLine(stage: Konva.Stage | null) {
  const update = stage?.getAttr(WIDGET_CONNECTION_DRAG_UPDATE_ATTR) as TConnectionDragUpdate | undefined
  update?.()
}

function setupConnectionBoundary(portal: TPortal, setCursor: (cursor: string) => void) {
  if (!(portal.node instanceof portal.Group)) return false
  const widgetNode = portal.node

  const boundary = widgetNode.findOne(`#${WIDGET_CONNECTION_BOUNDARY_ID}`)
  const handle = widgetNode.findOne(`#${WIDGET_CONNECTION_HANDLE_ID}`)
  if (!(handle instanceof portal.Circle) || !boundary) return false

  let pulseTimer: ReturnType<typeof setInterval> | null = null
  let pulseAmount = 0
  let tempLine: Konva.Line | null = null
  let isConnecting = false
  let connectionSourceArc = 0

  const stopPulse = () => {
    if (pulseTimer) {
      clearInterval(pulseTimer)
      pulseTimer = null
    }
    pulseAmount = 0
    if (!isConnecting) {
      handle.visible(false)
    }
    handle.radius(10)
    handle.fill('#38bdf8')
    handle.opacity(0.95)
    handle.getLayer()?.batchDraw()
  }

  const startPulse = () => {
    if (pulseTimer || isConnecting) return
    handle.visible(true)
    pulseTimer = setInterval(() => {
      pulseAmount += 0.25
      handle.radius(10 + Math.sin(pulseAmount) * 2.75)
      handle.opacity(0.78 + Math.cos(pulseAmount) * 0.17)
      handle.getLayer()?.batchDraw()
    }, 50)
  }

  const syncHandle = () => {
    const stage = widgetNode.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return

    const arc = getArcForPointer(portal, widgetNode, pointer)
    const point = getConnectionBoundaryPoint({
      arc,
      width: widgetNode.width(),
      height: widgetNode.height(),
    })
    const isPendingOutput = isConnectionDragActive(stage) && !isConnecting

    handle.position(point)
    handle.fill(isPendingOutput ? '#94a3b8' : '#38bdf8')
    handle.stroke(isPendingOutput ? '#e2e8f0' : '#e0f2fe')
    handle.shadowColor(isPendingOutput ? '#94a3b8' : '#38bdf8')
    handle.setAttr('widgetConnectionArc', arc)
    handle.visible(true)
    handle.getLayer()?.batchDraw()
  }

  const cleanupConnectionDrag = () => {
    const stage = widgetNode.getStage()
    stage?.off('pointermove.widgetConnection pointerup.widgetConnection pointercancel.widgetConnection')
    tempLine?.destroy()
    tempLine = null
    isConnecting = false
    stage?.setAttr(WIDGET_CONNECTION_DRAG_ACTIVE_ATTR, false)
    stage?.setAttr(WIDGET_CONNECTION_DRAG_UPDATE_ATTR, undefined)
    handle.fill('#38bdf8')
    handle.radius(10)
    handle.opacity(0.95)
    handle.visible(false)
    setCursor('pointer')
    widgetNode.draggable(true)
    portal.syncConnections?.(widgetNode)
    widgetNode.getLayer()?.batchDraw()
  }

  const startConnectionDrag = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const stage = widgetNode.getStage()
    const layer = widgetNode.getLayer()
    const pointer = stage?.getPointerPosition()
    if (!stage || !layer || !pointer || !portal.Line) return

    event.cancelBubble = true
    safeStopDrag(widgetNode)
    widgetNode.draggable(false)
    stopPulse()
    isConnecting = true
    setCursor('pointer')
    connectionSourceArc = getArcForPointer(portal, widgetNode, pointer)
    handle.fill('#38bdf8')
    handle.visible(true)

    const sourcePoint = toLayerPoint(layer, getBoundaryAbsolutePoint(widgetNode, connectionSourceArc))
    const pointerPoint = toLayerPoint(layer, pointer)
    tempLine = new portal.Line({
      points: [sourcePoint.x, sourcePoint.y, pointerPoint.x, pointerPoint.y],
      stroke: '#38bdf8',
      strokeWidth: 2,
      dash: [8, 6],
      lineCap: 'round',
      lineJoin: 'round',
      listening: false,
    })
    layer.add(tempLine)
    layer.batchDraw()

    const updateTempLine = () => {
      const nextPointer = stage.getPointerPosition()
      if (!nextPointer || !tempLine) return
      const nextPointerPoint = toLayerPoint(layer, nextPointer)
      tempLine.points([sourcePoint.x, sourcePoint.y, nextPointerPoint.x, nextPointerPoint.y])
      layer.batchDraw()
    }

    stage.setAttr(WIDGET_CONNECTION_DRAG_ACTIVE_ATTR, true)
    stage.setAttr(WIDGET_CONNECTION_DRAG_UPDATE_ATTR, updateTempLine)
    stage.off('pointermove.widgetConnection pointerup.widgetConnection pointercancel.widgetConnection')
    stage.on('pointermove.widgetConnection', updateTempLine)
    stage.on('pointerup.widgetConnection pointercancel.widgetConnection', () => {
      const nextPointer = stage.getPointerPosition()
      if (nextPointer) {
        const hit = stage.getIntersection(nextPointer)
        const target = getWidgetGroupFromNode(portal, hit)
        if (target && target !== widgetNode) {
          appendWidgetConnection(portal, {
            source: target,
            target: widgetNode,
            sourceArc: getArcForPointer(portal, target, nextPointer),
            targetArc: connectionSourceArc,
          })
        }
      }
      cleanupConnectionDrag()
    })
  }

  handle.off('pointerdown pointerclick')
  handle.on('pointerdown', startConnectionDrag)
  handle.on('pointerclick', (event) => {
    event.cancelBubble = true
    setCursor('pointer')
  })

  boundary.off('pointerover pointermove pointerout pointerdown pointerclick')
  boundary.on('pointerover', (event) => {
    event.cancelBubble = true
    setCursor('pointer')
    updateActiveConnectionDragLine(widgetNode.getStage())
    syncHandle()
    startPulse()
  })
  boundary.on('pointermove', (event) => {
    event.cancelBubble = true
    updateActiveConnectionDragLine(widgetNode.getStage())
    syncHandle()
  })
  boundary.on('pointerdown', startConnectionDrag)
  boundary.on('pointerclick', (event) => {
    event.cancelBubble = true
    setCursor('pointer')
  })
  boundary.on('pointerout', (event) => {
    event.cancelBubble = true
    if (isConnecting) return
    setCursor('default')
    stopPulse()
  })
  widgetNode.on('destroy', () => {
    stopPulse()
    cleanupConnectionDrag()
  })

  return true
}

function setupDragListener(portal: TPortal) {
  if (!(portal.node instanceof portal.Group)) return false
  const widgetNode = portal.node

  widgetNode.off('dragend')
  widgetNode.on('dragmove', () => {
    portal.syncConnections?.(widgetNode, {
      scope: "attached",
      syncHandles: false,
    })
  })

  widgetNode.on('dragend', () => {
    portal.crdtService.build()
      .patchElement(widgetNode.id(), 'x', widgetNode.x())
      .patchElement(widgetNode.id(), 'y', widgetNode.y())
      .commit()
    portal.syncConnections?.(widgetNode)
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
  if(header) setupCursor(setCursor, portal.node, header)
  setupConnectionBoundary(portal, setCursor)
  setupDragListener(portal)
  portal.syncConnections?.(portal.node)

  return didAttachSelectable
}
