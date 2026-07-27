import { fnCanvasProductNodeId } from "./fn.targets";
import type { TCanvasProductRuntimeEnginePorts } from "./interface";
import type {
  TCanvasProductPoint,
  TCanvasProductRect,
  TCanvasProductTargetRef,
} from "./typed";

type TGeometryPorts = Pick<
  TCanvasProductRuntimeEnginePorts,
  "camera" | "geometry" | "getProjectionIndex"
>;

export class CanvasProductGeometryService {
  readonly #ports: TGeometryPorts;
  #destroyed = false;

  constructor(ports: TGeometryPorts) {
    this.#ports = ports;
  }

  worldBounds(
    ref: TCanvasProductTargetRef,
    options?: {
      includeEffects?: boolean;
      includeDescendants?: boolean;
    },
  ): TCanvasProductRect | null {
    const nodeId = this.#nodeId(ref);
    return nodeId === null
      ? null
      : this.#ports.geometry.worldBounds(nodeId, options);
  }

  unionBounds(
    refs: readonly TCanvasProductTargetRef[],
  ): TCanvasProductRect | null {
    this.#assertActive();
    const index = this.#ports.getProjectionIndex();
    if (index === null) {
      return null;
    }
    const nodeIds = refs.flatMap((ref) => {
      const nodeId = fnCanvasProductNodeId({ ref, index });
      return nodeId === null ? [] : [nodeId];
    });
    return nodeIds.length === 0
      ? null
      : this.#ports.geometry.unionBounds(nodeIds);
  }

  localToWorld(
    ref: TCanvasProductTargetRef,
    point: TCanvasProductPoint,
  ): TCanvasProductPoint | null {
    const nodeId = this.#nodeId(ref);
    return nodeId === null
      ? null
      : this.#ports.geometry.localToWorld(nodeId, point);
  }

  worldToLocal(
    ref: TCanvasProductTargetRef,
    point: TCanvasProductPoint,
  ): TCanvasProductPoint | null {
    const nodeId = this.#nodeId(ref);
    return nodeId === null
      ? null
      : this.#ports.geometry.worldToLocal(nodeId, point);
  }

  intersectsRect(
    ref: TCanvasProductTargetRef,
    rect: TCanvasProductRect,
    mode: "bounds" | "geometry" | "painted" = "painted",
  ): boolean {
    const nodeId = this.#nodeId(ref);
    return nodeId !== null
      && this.#ports.geometry.intersectsRect(nodeId, rect, mode);
  }

  intersectsPolygon(
    ref: TCanvasProductTargetRef,
    points: readonly TCanvasProductPoint[],
    mode: "bounds" | "geometry" | "painted" = "painted",
  ): boolean {
    const nodeId = this.#nodeId(ref);
    return nodeId !== null
      && this.#ports.geometry.intersectsPolygon(
        nodeId,
        points.map((point) => ({ ...point })),
        mode,
      );
  }

  nearestPoint(
    ref: TCanvasProductTargetRef,
    point: TCanvasProductPoint,
  ): {
    point: TCanvasProductPoint;
    distance: number;
    pathOffset?: number;
    segmentIndex?: number;
  } | null {
    const nodeId = this.#nodeId(ref);
    const result = nodeId === null
      ? null
      : this.#ports.geometry.nearestPoint(nodeId, point);
    return result === null ? null : {
      ...result,
      point: { ...result.point },
    };
  }

  clientToViewport(point: TCanvasProductPoint): TCanvasProductPoint {
    this.#assertActive();
    return this.#ports.camera.clientToViewport(point);
  }

  viewportToClient(point: TCanvasProductPoint): TCanvasProductPoint {
    this.#assertActive();
    return this.#ports.camera.viewportToClient(point);
  }

  viewportToWorld(point: TCanvasProductPoint): TCanvasProductPoint {
    this.#assertActive();
    return this.#ports.camera.viewportToWorld(point);
  }

  worldToViewport(point: TCanvasProductPoint): TCanvasProductPoint {
    this.#assertActive();
    return this.#ports.camera.worldToViewport(point);
  }

  worldToClient(point: TCanvasProductPoint): TCanvasProductPoint {
    this.#assertActive();
    return this.#ports.camera.worldToClient(point);
  }

  visibleWorldBounds(): TCanvasProductRect {
    this.#assertActive();
    return this.#ports.camera.visibleWorldBounds();
  }

  destroy(): void {
    this.#destroyed = true;
  }

  #nodeId(ref: TCanvasProductTargetRef): string | null {
    this.#assertActive();
    const index = this.#ports.getProjectionIndex();
    return index === null ? null : fnCanvasProductNodeId({ ref, index });
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasProductGeometryService has been destroyed.");
    }
  }
}
