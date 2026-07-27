import type { IService, IStoppableService } from "@vibecanvas/runtime";
import type { TWidgetFrameBounds } from "@vibecanvas/orpc-client";
import type { TCanvasProductTransientOwner } from "../../engine/product-runtime/typed";
import type { CameraService } from "../camera/CameraService";
import type { SceneService } from "../scene/SceneService";
import {
  fnClampWidgetFrameToViewport,
  fnHasWidgetDragThreshold,
  fnWidgetDropGhostProjection,
  fnWidgetPlacementReferenceIsAvailable,
} from "./fn.widget-placement";
import type {
  TClientPoint,
  TWidgetDropRequest,
  TWidgetPlacementCancelReason,
  TWidgetWorldBounds,
} from "./types";

const DRAG_THRESHOLD_PX = 6;

type TPointerSession = {
  request: TWidgetDropRequest;
  pointerId: number;
  origin: TClientPoint;
  dragging: boolean;
  previousUserSelect: string;
};

export class WidgetDropPlacementService implements IService, IStoppableService {
  readonly name = "widget-drop-placement";
  readonly #camera: CameraService;
  readonly #scene: SceneService;
  #session: TPointerSession | null = null;
  #ghost: TCanvasProductTransientOwner | null = null;
  #ghostBounds: TWidgetWorldBounds | null = null;
  #ghostSequence = 0;

  constructor(args: { camera: CameraService; scene: SceneService }) {
    this.#camera = args.camera;
    this.#scene = args.scene;
  }

  stop(): void {
    this.cancel("canvas-destroyed");
    this.#destroyGhost();
  }

  beginPointerSession(request: TWidgetDropRequest, event: PointerEvent): boolean {
    if (event.button !== 0 || event.isPrimary === false) return false;
    this.cancel("replaced");
    this.#destroyGhost();
    const document = this.#scene.container.ownerDocument;
    this.#session = {
      request,
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      dragging: false,
      previousUserSelect: document.body.style.userSelect,
    };
    document.addEventListener("pointermove", this.#onPointerMove, { passive: false });
    document.addEventListener("pointerup", this.#onPointerUp, { passive: false });
    document.addEventListener("pointercancel", this.#onPointerCancel, { passive: false });
    document.addEventListener("keydown", this.#onKeyDown);
    return true;
  }

  async addAtViewportCenter(request: TWidgetDropRequest): Promise<void> {
    this.cancel("replaced");
    this.#destroyGhost();
    const visible = this.#camera.visibleWorldBounds();
    const worldPoint = {
      x: visible.minX
        + Math.max(0, (visible.maxX - visible.minX - request.bounds.width) / 2),
      y: visible.minY
        + Math.max(0, (visible.maxY - visible.minY - request.bounds.height) / 2),
    };
    const clientPoint = this.#camera.worldToClient(worldPoint);
    this.#syncGhost(request, clientPoint);
    const ghost = this.#ghost;
    this.#markGhostCommitting(request);
    await this.#commitWithGhost(request, clientPoint, ghost);
  }

  resolveWorldBounds(clientPoint: TClientPoint, bounds: TWidgetFrameBounds): TWidgetWorldBounds {
    const point = this.#camera.viewportToWorld(
      this.#camera.clientToViewport(clientPoint),
    );
    const visible = this.#camera.visibleWorldBounds();
    const viewport = {
      x: visible.minX,
      y: visible.minY,
      width: visible.maxX - visible.minX,
      height: visible.maxY - visible.minY,
    };
    return fnClampWidgetFrameToViewport({ point, bounds, viewport });
  }

  cancel(reason: TWidgetPlacementCancelReason): void {
    const session = this.#session;
    if (!session) return;
    this.#cleanupSession();
    if (session.dragging) {
      session.request.onCancel?.(reason);
      session.request.onDragEnd?.();
    }
  }

  cancelIfReferenceUnavailable(availableReferences: readonly TWidgetDropRequest["reference"][]): void {
    const reference = this.#session?.request.reference;
    if (!reference || fnWidgetPlacementReferenceIsAvailable({ reference, availableReferences })) return;
    this.cancel("source-changed");
  }

  readonly #onPointerMove = (event: PointerEvent) => {
    const session = this.#session;
    if (!session || event.pointerId !== session.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (!session.dragging && fnHasWidgetDragThreshold({ origin: session.origin, point, threshold: DRAG_THRESHOLD_PX })) {
      session.dragging = true;
      this.#scene.container.ownerDocument.body.style.userSelect = "none";
      session.request.onDragStart?.();
    }
    if (!session.dragging) return;
    event.preventDefault();
    if (!this.#containsClientPoint(point)) {
      this.#destroyGhost();
      return;
    }
    this.#syncGhost(session.request, point);
  };

  readonly #onPointerUp = (event: PointerEvent) => {
    const session = this.#session;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!session.dragging) {
      this.#cleanupSession();
      return;
    }
    event.preventDefault();
    const point = this.#containsClientPoint({ x: event.clientX, y: event.clientY })
      ? { x: event.clientX, y: event.clientY }
      : null;
    if (!point) {
      this.#cleanupSession();
      session.request.onDragEnd?.();
      session.request.onCancel?.("outside-canvas");
      return;
    }
    this.#syncGhost(session.request, point);
    const ghost = this.#ghost;
    this.#markGhostCommitting(session.request);
    this.#cleanupSession(false);
    session.request.onDragEnd?.();
    void this.#commitWithGhost(session.request, point, ghost).catch(() => undefined);
  };

  readonly #onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId === this.#session?.pointerId) this.cancel("pointer-cancel");
  };

  readonly #onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !this.#session?.dragging) return;
    event.preventDefault();
    this.cancel("escape");
  };

  #containsClientPoint(point: TClientPoint): boolean {
    const rect = this.#scene.container.getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  #syncGhost(request: TWidgetDropRequest, point: TClientPoint): void {
    const bounds = this.resolveWorldBounds(point, request.bounds);
    if (!this.#ghost) {
      this.#ghostSequence += 1;
      this.#ghost = this.#scene.product.transients.createOwner({
        ownerId: `vc:transient:widget-drop:${this.#ghostSequence}`,
      });
    }
    this.#ghostBounds = bounds;
    this.#ghost.replace(fnWidgetDropGhostProjection({
      request,
      position: bounds,
      zoom: this.#camera.zoom,
      state: "positioning",
    }));
  }

  #markGhostCommitting(request: TWidgetDropRequest): void {
    if (!this.#ghost || !this.#ghostBounds) return;
    this.#ghost.replace(fnWidgetDropGhostProjection({
      request,
      position: this.#ghostBounds,
      zoom: this.#camera.zoom,
      state: "committing",
    }));
  }

  async #commitWithGhost(
    request: TWidgetDropRequest,
    clientPoint: TClientPoint,
    ghost: TCanvasProductTransientOwner | null,
  ): Promise<void> {
    try {
      await request.onCommit({
        reference: request.reference,
        bounds: request.bounds,
        clientPoint,
      });
    } finally {
      this.#destroyGhost(ghost);
    }
  }

  #destroyGhost(ghost: TCanvasProductTransientOwner | null = this.#ghost): void {
    ghost?.destroy();
    if (this.#ghost === ghost) {
      this.#ghost = null;
      this.#ghostBounds = null;
    }
  }

  #cleanupSession(destroyGhost = true): void {
    const session = this.#session;
    if (!session) return;
    const document = this.#scene.container.ownerDocument;
    document.removeEventListener("pointermove", this.#onPointerMove);
    document.removeEventListener("pointerup", this.#onPointerUp);
    document.removeEventListener("pointercancel", this.#onPointerCancel);
    document.removeEventListener("keydown", this.#onKeyDown);
    document.body.style.userSelect = session.previousUserSelect;
    this.#session = null;
    if (destroyGhost) this.#destroyGhost();
  }
}
