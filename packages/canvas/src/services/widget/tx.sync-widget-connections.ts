import type { TWidgetData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import type Konva from "konva";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import {
  WIDGET_CONNECTION_BOUNDARY_OFFSET,
  WIDGET_CONNECTION_INPUT_HANDLE_ID_PREFIX,
  WIDGET_CONNECTION_OUTPUT_HANDLE_ID_PREFIX,
} from "./CONSTANTS";

type TPortalSyncWidgetConnections = {
  Circle?: typeof Konva.Circle;
  Group: typeof Konva.Group;
  Line?: typeof Konva.Line;
};

type TArgsSyncWidgetConnections = {
  node: Konva.Group;
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
  const lineId = `widget-connection-line-${args.id}`;
  const existingLine = args.layer.findOne(`#${lineId}`);

  if (existingLine instanceof Line) {
    existingLine.points([sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y]);
    existingLine.moveToBottom();
  } else {
    const line = new Line({
      id: lineId,
      points: [sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y],
      stroke: "#94a3b8",
      strokeWidth: 2,
      lineCap: "round",
      lineJoin: "round",
      listening: false,
    });
    args.layer.add(line);
    line.moveToBottom();
  }

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

export function txSyncWidgetConnections(portal: TPortalSyncWidgetConnections, args: TArgsSyncWidgetConnections) {
  const layer = args.node.getLayer();
  if (!portal.Line || !layer) return false;

  const widgets = layer.find((node: Konva.Node) => {
    return node instanceof portal.Group && node.getAttr(ELEMENT_DATA_ATTR)?.type === "widget";
  }).filter((node): node is Konva.Group => node instanceof portal.Group);
  const widgetById = new Map(widgets.map((widget) => [widget.id(), widget]));

  widgets.forEach((target) => {
    const targetData = target.getAttr(ELEMENT_DATA_ATTR) as TWidgetData | undefined;
    if (targetData?.type !== "widget") return;

    targetData.connections?.inputs?.forEach((connection) => {
      const source = widgetById.get(connection.sourceWidgetId);
      if (!source) return;

      syncConnectionLine(portal, {
        id: connection.id,
        layer,
        source,
        target,
        sourceArc: connection.line.sourceArc,
        targetArc: connection.line.targetArc,
      });
    });
  });
  layer.batchDraw();

  return true;
}
