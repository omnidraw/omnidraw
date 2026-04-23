import type Konva from "konva";
import { ELEMENT_DATA_ATTR } from "../../core/CONSTANTS";
import { fnGetAbsolutePositionFromWorldPosition } from "../../core/fn.world-position";
import {
  CURVE_TENSION,
  type THandleDragSnapshot,
  type TPoint,
  type TShape1dData,
  type TShape1dNode,
} from "./CONSTANTS";
import { fxGetElementData } from "./fx.node";

function getLayerAbsoluteTransform(node: Konva.Node) {
  return node.getLayer()?.getAbsoluteTransform().copy() ?? null;
}

function absolutePointToLocal(transform: Konva.Transform, point: { x: number; y: number }) {
  return transform.copy().invert().point(point);
}

function getCurveControlPoints(points: TPoint[], index: number) {
  const p0 = points[index - 1] ?? points[index]!;
  const p1 = points[index]!;
  const p2 = points[index + 1]!;
  const p3 = points[index + 2] ?? p2;
  const cp1: TPoint = [
    p1[0] + ((p2[0] - p0[0]) / 6) * CURVE_TENSION,
    p1[1] + ((p2[1] - p0[1]) / 6) * CURVE_TENSION,
  ];
  const cp2: TPoint = [
    p2[0] - ((p3[0] - p1[0]) / 6) * CURVE_TENSION,
    p2[1] - ((p3[1] - p1[1]) / 6) * CURVE_TENSION,
  ];
  return { p1, cp1, cp2, p2 };
}

function evaluateCubicPoint(p1: TPoint, cp1: TPoint, cp2: TPoint, p2: TPoint, t: number): TPoint {
  const mt = 1 - t;
  return [
    mt ** 3 * p1[0] + 3 * mt ** 2 * t * cp1[0] + 3 * mt * t ** 2 * cp2[0] + t ** 3 * p2[0],
    mt ** 3 * p1[1] + 3 * mt ** 2 * t * cp1[1] + 3 * mt * t ** 2 * cp2[1] + t ** 3 * p2[1],
  ];
}

export type TPortalFxWorldPointToLocal = {};
export type TArgsFxWorldPointToLocal = { node: TShape1dNode; point: { x: number; y: number } };
export function fxWorldPointToLocal(portal: TPortalFxWorldPointToLocal, args: TArgsFxWorldPointToLocal) {
  void portal;
  const layerTransform = getLayerAbsoluteTransform(args.node);
  const absolutePoint = layerTransform ? layerTransform.point(args.point) : args.point;
  return args.node.getAbsoluteTransform().copy().invert().point(absolutePoint);
}

export type TPortalFxLocalPointToWorld = {};
export type TArgsFxLocalPointToWorld = { node: TShape1dNode; point: TPoint | { x: number; y: number } };
export function fxLocalPointToWorld(portal: TPortalFxLocalPointToWorld, args: TArgsFxLocalPointToWorld) {
  void portal;
  const resolvedPoint = Array.isArray(args.point) ? { x: args.point[0], y: args.point[1] } : args.point;
  const absolutePoint = args.node.getAbsoluteTransform().point(resolvedPoint);
  const layerTransform = getLayerAbsoluteTransform(args.node);
  return layerTransform ? layerTransform.invert().point(absolutePoint) : absolutePoint;
}

export type TPortalFxGetInsertionPoint = {};
export type TArgsFxGetInsertionPoint = { data: TShape1dData; segmentIndex: number };
export function fxGetInsertionPoint(portal: TPortalFxGetInsertionPoint, args: TArgsFxGetInsertionPoint): TPoint {
  void portal;
  const p1 = args.data.points[args.segmentIndex];
  const p2 = args.data.points[args.segmentIndex + 1];
  if (!p1 || !p2) {
    return [0, 0];
  }

  if (args.data.lineType === "curved" && args.data.points.length > 2) {
    const { p1: start, cp1, cp2, p2: end } = getCurveControlPoints(args.data.points, args.segmentIndex);
    return evaluateCubicPoint(start, cp1, cp2, end, 0.5);
  }

  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

export type TPortalFxApplyAnchorDrag = {};
export type TArgsFxApplyAnchorDrag = {
  node: TShape1dNode;
  drag: THandleDragSnapshot;
  worldPoint: { x: number; y: number };
};
export function fxApplyAnchorDrag(portal: TPortalFxApplyAnchorDrag, args: TArgsFxApplyAnchorDrag) {
  void portal;
  const data = fxGetElementData({}, { node: args.node });
  if (!data) {
    return;
  }

  const nextData = structuredClone(data);
  if (args.drag.pointIndex === 0) {
    args.node.absolutePosition(fnGetAbsolutePositionFromWorldPosition({
      worldPosition: args.worldPoint,
      parentTransform: args.node.getLayer()?.getAbsoluteTransform() ?? null,
    }));
    nextData.points = args.drag.beforePoints.map((point, index) => {
      if (index === 0) {
        return [0, 0];
      }

      const absolutePoint = args.drag.beforeAbsoluteTransform.point({ x: point[0], y: point[1] });
      const nextLocal = absolutePointToLocal(args.node.getAbsoluteTransform(), absolutePoint);
      return [nextLocal.x, nextLocal.y] as TPoint;
    });
  } else {
    const nextLocal = fxWorldPointToLocal({}, { node: args.node, point: args.worldPoint });
    nextData.points[args.drag.pointIndex] = [nextLocal.x, nextLocal.y];
  }

  args.node.setAttr(ELEMENT_DATA_ATTR, nextData);
  args.node.getLayer()?.batchDraw();
}
