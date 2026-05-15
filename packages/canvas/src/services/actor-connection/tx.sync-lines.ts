import type { TActorConnection } from '@vibecanvas/api-actors/contract';
import type Konva from 'konva';
import { isKonvaLine } from '../../core/GUARDS';
import { CanvasMode } from '../selection/CONSTANTS';
import type { SelectionService } from '../selection/SelectionService';
import {
  ACTOR_CONNECTION_LINE_ID_PREFIX,
  ACTOR_CONNECTION_SOURCE_HANDLE_ID_PREFIX,
  ACTOR_CONNECTION_TARGET_HANDLE_ID_PREFIX,
} from './CONSTANTS';
import { fnGetActorConnectionBoundaryPoint, fnReadActorConnectionArc, fnReadActorConnectionStroke } from './fn.geometry';

export type TPortalSyncActorConnectionLines = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line: typeof Konva.Line;
  layer: Konva.Layer | Konva.FastLayer;
  selection: SelectionService;
};

export type TArgsSyncActorConnectionLines = {
  connections: TActorConnection[];
  sourceNode?: Konva.Group;
  syncHandles?: boolean;
};

export type TArgsRemoveActorConnectionLine = {
  id: string;
};

const CONNECTION_LINE_CACHE = new WeakMap<Konva.Layer | Konva.FastLayer, Map<string, Konva.Line>>();

function txToLayerPoint(layer: Konva.Layer | Konva.FastLayer, point: { x: number; y: number }) {
  return layer.getAbsoluteTransform().copy().invert().point(point);
}

function txGetCachedConnectionLine(layer: Konva.Layer | Konva.FastLayer, lineId: string) {
  const cache = CONNECTION_LINE_CACHE.get(layer);
  const line = cache?.get(lineId);
  if (!line) return null;
  if (line.getLayer() === layer) return line;

  cache?.delete(lineId);
  return null;
}

function txSetCachedConnectionLine(layer: Konva.Layer | Konva.FastLayer, lineId: string, line: Konva.Line) {
  const cache = CONNECTION_LINE_CACHE.get(layer) ?? new Map<string, Konva.Line>();
  cache.set(lineId, line);
  CONNECTION_LINE_CACHE.set(layer, cache);
}

function txGetConnectionLineHitStrokeWidth(layer: Konva.Layer | Konva.FastLayer) {
  const zoom = Math.abs(layer.getAbsoluteScale().x) || 1;
  return Math.max(32, 32 / zoom);
}

function txFindWidgetNode(portal: TPortalSyncActorConnectionLines, id: string) {
  const node = portal.layer.findOne((candidate: Konva.Node) => {
    return candidate instanceof portal.Group && candidate.id() === id;
  });

  return node instanceof portal.Group ? node : null;
}

function txSyncConnectionHandle(portal: TPortalSyncActorConnectionLines, args: {
  node: Konva.Group;
  id: string;
  point: { x: number; y: number };
  fill: string;
  stroke: string;
}) {
  const Circle = portal.Circle;
  if (!Circle) return;

  const existing = args.node.findOne(`#${args.id}`);
  if (existing instanceof Circle) {
    existing.position(args.point);
    existing.moveToTop();
    return;
  }

  const handle = new Circle({
    id: args.id,
    x: args.point.x,
    y: args.point.y,
    radius: 8,
    fill: args.fill,
    stroke: args.stroke,
    strokeWidth: 2,
    opacity: 0.9,
    listening: false,
  });
  args.node.add(handle);
  handle.moveToTop();
}

function txSyncActorConnectionLine(portal: TPortalSyncActorConnectionLines, args: {
  connection: TActorConnection;
  source: Konva.Group;
  target: Konva.Group;
  syncHandles: boolean;
}) {
  const sourceArc = fnReadActorConnectionArc({ style: args.connection.style, key: 'sourceArc', fallback: 0 });
  const targetArc = fnReadActorConnectionArc({ style: args.connection.style, key: 'targetArc', fallback: 0.5 });
  const sourceLocalPoint = fnGetActorConnectionBoundaryPoint({ arc: sourceArc, width: args.source.width(), height: args.source.height() });
  const targetLocalPoint = fnGetActorConnectionBoundaryPoint({ arc: targetArc, width: args.target.width(), height: args.target.height() });
  const sourcePoint = txToLayerPoint(portal.layer, args.source.getAbsoluteTransform().point(sourceLocalPoint));
  const targetPoint = txToLayerPoint(portal.layer, args.target.getAbsoluteTransform().point(targetLocalPoint));
  const lineId = `${ACTOR_CONNECTION_LINE_ID_PREFIX}-${args.connection.id}`;
  const isSelected = portal.selection.selectedConnectionId === args.connection.id;
  const cachedLine = txGetCachedConnectionLine(portal.layer, lineId);
  const foundLine = !cachedLine ? portal.layer.findOne(`#${lineId}`) : null;
  const existingLine = cachedLine ?? (isKonvaLine(foundLine) ? foundLine : null);
  const connectionLine = existingLine ?? new portal.Line({ id: lineId });
  const baseStroke = args.connection.enabled ? fnReadActorConnectionStroke({ style: args.connection.style, fallback: '#94a3b8' }) : '#64748b';

  if (!existingLine) {
    portal.layer.add(connectionLine);
    connectionLine.moveToBottom();
  }
  txSetCachedConnectionLine(portal.layer, lineId, connectionLine);

  connectionLine.points([sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y]);
  connectionLine.stroke(isSelected ? '#38bdf8' : baseStroke);
  connectionLine.strokeWidth(isSelected ? 4 : 2);
  connectionLine.opacity(args.connection.enabled ? 1 : 0.45);
  connectionLine.dash(args.connection.enabled ? [] : [8, 6]);
  connectionLine.hitStrokeWidth(txGetConnectionLineHitStrokeWidth(portal.layer));
  connectionLine.listening(true);
  connectionLine.draggable(false);
  connectionLine.position({ x: 0, y: 0 });
  connectionLine.lineCap('round');
  connectionLine.lineJoin('round');
  connectionLine.shadowEnabled(isSelected);
  connectionLine.shadowColor('#38bdf8');
  connectionLine.shadowBlur(isSelected ? 12 : 0);
  connectionLine.shadowOpacity(isSelected ? 0.55 : 0);
  connectionLine.setAttr('vcInteractionOverlay', true);
  connectionLine.setAttr('actorConnectionId', args.connection.id);
  connectionLine.setAttr('widgetConnectionId', args.connection.id);
  connectionLine.off('pointerdown.actorConnectionSelection dragstart.actorConnectionNoDrag dragmove.actorConnectionNoDrag');
  connectionLine.on('pointerdown.actorConnectionSelection', (event) => {
    if (portal.selection.mode !== CanvasMode.SELECT) return;
    if (event.evt.button !== 0) return;
    event.cancelBubble = true;
    portal.selection.setSelectedConnectionId(args.connection.id);
  });
  connectionLine.on('dragstart.actorConnectionNoDrag dragmove.actorConnectionNoDrag', (event) => {
    event.cancelBubble = true;
    connectionLine.stopDrag();
    connectionLine.draggable(false);
    connectionLine.position({ x: 0, y: 0 });
  });

  if (!args.syncHandles) return;

  txSyncConnectionHandle(portal, { node: args.source, id: `${ACTOR_CONNECTION_SOURCE_HANDLE_ID_PREFIX}-${args.connection.id}`, point: sourceLocalPoint, fill: '#94a3b8', stroke: '#e2e8f0' });
  txSyncConnectionHandle(portal, { node: args.target, id: `${ACTOR_CONNECTION_TARGET_HANDLE_ID_PREFIX}-${args.connection.id}`, point: targetLocalPoint, fill: '#38bdf8', stroke: '#e0f2fe' });
}

export function txRemoveActorConnectionLine(portal: TPortalSyncActorConnectionLines, args: TArgsRemoveActorConnectionLine) {
  portal.layer.findOne(`#${ACTOR_CONNECTION_LINE_ID_PREFIX}-${args.id}`)?.destroy();
  portal.layer.findOne(`#${ACTOR_CONNECTION_SOURCE_HANDLE_ID_PREFIX}-${args.id}`)?.destroy();
  portal.layer.findOne(`#${ACTOR_CONNECTION_TARGET_HANDLE_ID_PREFIX}-${args.id}`)?.destroy();
  if (portal.selection.selectedConnectionId === args.id) {
    portal.selection.setSelectedConnectionId(null);
  }
  portal.layer.batchDraw();
}

export function txSyncActorConnectionLines(portal: TPortalSyncActorConnectionLines, args: TArgsSyncActorConnectionLines) {
  const syncHandles = args.syncHandles ?? true;
  const sourceNodeId = args.sourceNode?.id();
  const seen = new Set<string>();

  args.connections.forEach((connection) => {
    if (sourceNodeId && connection.source_element_id !== sourceNodeId && connection.target_element_id !== sourceNodeId) return;

    const source = txFindWidgetNode(portal, connection.source_element_id);
    const target = txFindWidgetNode(portal, connection.target_element_id);
    if (!source || !target) return;

    seen.add(connection.id);
    txSyncActorConnectionLine(portal, { connection, source, target, syncHandles });
  });

  if (!sourceNodeId) {
    portal.layer.find((node: Konva.Node) => {
      const id = node.getAttr('actorConnectionId');
      return typeof id === 'string' && !seen.has(id);
    }).forEach((node) => node.destroy());
  }

  portal.layer.batchDraw();
  return true;
}
