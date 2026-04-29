import type { TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { isKonvaLine } from "../../core/GUARDS";
import { CanvasMode } from "../selection/CONSTANTS";
import type { SelectionService } from "../selection/SelectionService";
import {
  WIDGET_CONNECTION_BOUNDARY_OFFSET,
  WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX,
  WIDGET_CONNECTION_LINE_ID_PREFIX,
  WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX,
} from "./CONSTANTS";

type TPortalSyncWidgetConnections = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
  selection?: SelectionService;
};

type TWidgetConnectionSyncScope = "all" | "attached";

type TArgsSyncWidgetConnections = {
  node: Konva.Group;
  scope?: TWidgetConnectionSyncScope;
  syncHandles?: boolean;
};

function getConnectionBoundaryPoint(args: { arc: number; width: number; height: number }) {
  const left = -WIDGET_CONNECTION_BOUNDARY_OFFSET;
  const top = -WIDGET_CONNECTION_BOUNDARY_OFFSET;
  const right = args.width + WIDGET_CONNECTION_BOUNDARY_OFFSET;
  const bottom = args.height + WIDGET_CONNECTION_BOUNDARY_OFFSET;
  const centerX = args.width / 2;
  const centerY = args.height / 2;
  const angle = args.arc * Math.PI * 2;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = dx > 0 ? (right - centerX) / dx : dx < 0 ? (left - centerX) / dx : Number.POSITIVE_INFINITY;
  const ty = dy > 0 ? (bottom - centerY) / dy : dy < 0 ? (top - centerY) / dy : Number.POSITIVE_INFINITY;
  const distance = Math.min(tx, ty);

  return { x: centerX + dx * distance, y: centerY + dy * distance };
}

function toLayerPoint(layer: Konva.Layer | Konva.FastLayer, point: { x: number; y: number }) {
  return layer.getAbsoluteTransform().copy().invert().point(point);
}

function getConnectionLineHitStrokeWidth(layer: Konva.Layer | Konva.FastLayer) {
  const zoom = Math.abs(layer.getAbsoluteScale().x) || 1;
  return Math.max(32, 32 / zoom);
}

function syncConnectionHandle(portal: TPortalSyncWidgetConnections, args: {
  node: Konva.Group;
  id: string;
  point: { x: number; y: number };
  fill: string;
  stroke: string;
  shadowColor: string;
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
    radius: 10,
    fill: args.fill,
    stroke: args.stroke,
    strokeWidth: 3,
    shadowColor: args.shadowColor,
    shadowBlur: 14,
    shadowOpacity: 0.65,
    opacity: 0.95,
    listening: false,
  });
  args.node.add(handle);
  handle.moveToTop();
}

function syncConnectionLine(portal: TPortalSyncWidgetConnections, args: {
  id: string;
  layer: Konva.Layer | Konva.FastLayer;
  source: Konva.Group;
  target: Konva.Group;
  sourceArc: number;
  targetArc: number;
  syncHandles: boolean;
}) {
  const Line = portal.Line;
  if (!Line) return;

  const sourceLocalPoint = getConnectionBoundaryPoint({
    arc: args.sourceArc,
    width: args.source.width(),
    height: args.source.height(),
  });
  const targetLocalPoint = getConnectionBoundaryPoint({
    arc: args.targetArc,
    width: args.target.width(),
    height: args.target.height(),
  });
  const sourcePoint = toLayerPoint(args.layer, args.source.getAbsoluteTransform().point(sourceLocalPoint));
  const targetPoint = toLayerPoint(args.layer, args.target.getAbsoluteTransform().point(targetLocalPoint));
  const lineId = `${WIDGET_CONNECTION_LINE_ID_PREFIX}-${args.id}`;
  const isSelected = portal.selection?.selectedConnectionId === args.id;
  const existingLine = args.layer.findOne(`#${lineId}`);
  const connectionLine = isKonvaLine(existingLine) ? existingLine : new Line({ id: lineId });

  if (!isKonvaLine(existingLine)) {
    args.layer.add(connectionLine);
    connectionLine.moveToBottom();
  }

  connectionLine.points([sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y]);
  connectionLine.stroke(isSelected ? "#38bdf8" : "#94a3b8");
  connectionLine.strokeWidth(isSelected ? 4 : 2);
  connectionLine.hitStrokeWidth(getConnectionLineHitStrokeWidth(args.layer));
  connectionLine.listening(true);
  connectionLine.draggable(false);
  connectionLine.position({ x: 0, y: 0 });
  connectionLine.lineCap("round");
  connectionLine.lineJoin("round");
  connectionLine.shadowEnabled(isSelected);
  connectionLine.shadowColor("#38bdf8");
  connectionLine.shadowBlur(isSelected ? 12 : 0);
  connectionLine.shadowOpacity(isSelected ? 0.55 : 0);
  connectionLine.setAttr("vcInteractionOverlay", true);
  connectionLine.setAttr("widgetConnectionId", args.id);
  connectionLine.off("pointerdown.widgetConnectionSelection dragstart.widgetConnectionNoDrag dragmove.widgetConnectionNoDrag");
  connectionLine.on("pointerdown.widgetConnectionSelection", (event) => {
    if (!portal.selection || portal.selection.mode !== CanvasMode.SELECT) return;
    if (event.evt.button !== 0) return;
    event.cancelBubble = true;
    portal.selection.setSelectedConnectionId(args.id);
  });
  connectionLine.on("dragstart.widgetConnectionNoDrag dragmove.widgetConnectionNoDrag", (event) => {
    event.cancelBubble = true;
    connectionLine.stopDrag();
    connectionLine.draggable(false);
    connectionLine.position({ x: 0, y: 0 });
  });

  if (!args.syncHandles) return;

  syncConnectionHandle(portal, {
    node: args.source,
    id: `${WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX}-${args.id}`,
    point: sourceLocalPoint,
    fill: "#94a3b8",
    stroke: "#e2e8f0",
    shadowColor: "#94a3b8",
  });
  syncConnectionHandle(portal, {
    node: args.target,
    id: `${WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX}-${args.id}`,
    point: targetLocalPoint,
    fill: "#38bdf8",
    stroke: "#e0f2fe",
    shadowColor: "#38bdf8",
  });
}

function syncWidgetInputConnections(portal: TPortalSyncWidgetConnections, args: {
  layer: Konva.Layer | Konva.FastLayer;
  widgetById: Map<string, Konva.Group>;
  target: Konva.Group;
  targetData: TWidgetData;
  syncHandles: boolean;
  syncedConnectionIds: Set<string>;
}) {
  args.targetData.connections?.inputs?.forEach((connection) => {
    if (args.syncedConnectionIds.has(connection.id)) return;

    const source = args.widgetById.get(connection.sourceWidgetId);
    if (!source) return;

    args.syncedConnectionIds.add(connection.id);
    syncConnectionLine(portal, {
      id: connection.id,
      layer: args.layer,
      source,
      target: args.target,
      sourceArc: connection.line.sourceArc,
      targetArc: connection.line.targetArc,
      syncHandles: args.syncHandles,
    });
  });
}

function syncAttachedWidgetOutputConnections(portal: TPortalSyncWidgetConnections, args: {
  layer: Konva.Layer | Konva.FastLayer;
  widgetById: Map<string, Konva.Group>;
  source: Konva.Group;
  sourceData: TWidgetData;
  syncHandles: boolean;
  syncedConnectionIds: Set<string>;
}) {
  args.sourceData.connections?.outputs?.forEach((connection) => {
    if (args.syncedConnectionIds.has(connection.id)) return;

    const target = args.widgetById.get(connection.targetWidgetId);
    const targetData = target?.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined;
    if (!target || targetData?.type !== "widget") return;

    const inputConnection = targetData.connections?.inputs?.find((candidate) => {
      return candidate.id === connection.id && candidate.sourceWidgetId === args.source.id();
    });
    if (!inputConnection) return;

    args.syncedConnectionIds.add(connection.id);
    syncConnectionLine(portal, {
      id: inputConnection.id,
      layer: args.layer,
      source: args.source,
      target,
      sourceArc: inputConnection.line.sourceArc,
      targetArc: inputConnection.line.targetArc,
      syncHandles: args.syncHandles,
    });
  });

  if ((args.sourceData.connections?.outputs?.length ?? 0) > 0) return;

  args.widgetById.forEach((target) => {
    const targetData = target.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined;
    if (targetData?.type !== "widget") return;

    targetData.connections?.inputs?.forEach((connection) => {
      if (connection.sourceWidgetId !== args.source.id()) return;
      if (args.syncedConnectionIds.has(connection.id)) return;

      args.syncedConnectionIds.add(connection.id);
      syncConnectionLine(portal, {
        id: connection.id,
        layer: args.layer,
        source: args.source,
        target,
        sourceArc: connection.line.sourceArc,
        targetArc: connection.line.targetArc,
        syncHandles: args.syncHandles,
      });
    });
  });
}

export function txSyncWidgetConnections(portal: TPortalSyncWidgetConnections, args: TArgsSyncWidgetConnections) {
  const layer = args.node.getLayer();
  if (!portal.Line || !layer) return false;

  const scope = args.scope ?? "all";
  const syncHandles = args.syncHandles ?? true;
  const widgets = layer.find((node: Konva.Node) => {
    return node instanceof portal.Group && node.getAttr(ELEMENT_DATA_ATTR)?.type === "widget";
  }).filter((node): node is Konva.Group => node instanceof portal.Group);
  const widgetById = new Map(widgets.map((widget) => [widget.id(), widget]));
  const syncedConnectionIds = new Set<string>();

  if (scope === "attached") {
    const nodeData = args.node.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined;
    if (nodeData?.type !== "widget") return false;

    syncWidgetInputConnections(portal, {
      layer,
      widgetById,
      target: args.node,
      targetData: nodeData,
      syncHandles,
      syncedConnectionIds,
    });
    syncAttachedWidgetOutputConnections(portal, {
      layer,
      widgetById,
      source: args.node,
      sourceData: nodeData,
      syncHandles,
      syncedConnectionIds,
    });
    layer.batchDraw();

    return true;
  }

  widgets.forEach((target) => {
    const targetData = target.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined;
    if (targetData?.type !== "widget") return;

    syncWidgetInputConnections(portal, {
      layer,
      widgetById,
      target,
      targetData,
      syncHandles,
      syncedConnectionIds,
    });
  });
  layer.batchDraw();

  return true;
}
