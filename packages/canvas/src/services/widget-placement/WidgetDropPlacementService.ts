import type { IService, IStoppableService } from "@vibecanvas/runtime";
import type { TWidgetFrameBounds } from "@vibecanvas/orpc-client";
import Konva from "konva";
import type { CameraService } from "../camera/CameraService";
import type { SceneService } from "../scene/SceneService";
import {
  fnClampWidgetFrameToViewport,
  fnClientPointToWidgetWorldPoint,
  fnHasWidgetDragThreshold,
  fnWidgetPlacementReferenceIsAvailable,
  fnWidgetVisibleWorldViewport,
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
  #ghost: Konva.Group | null = null;

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
    const rect = this.#scene.stage.container().getBoundingClientRect();
    const clientPoint = {
      x: rect.left + (rect.width - request.bounds.width * this.#camera.zoom) / 2,
      y: rect.top + (rect.height - request.bounds.height * this.#camera.zoom) / 2,
    };
    this.#syncGhost(request, clientPoint);
    const ghost = this.#ghost;
    this.#markGhostCommitting(request);
    await this.#commitWithGhost(request, clientPoint, ghost);
  }

  resolveWorldBounds(clientPoint: TClientPoint, bounds: TWidgetFrameBounds): TWidgetWorldBounds {
    const rect = this.#scene.stage.container().getBoundingClientRect();
    const point = fnClientPointToWidgetWorldPoint({
      clientPoint,
      canvasClientOrigin: { x: rect.left, y: rect.top },
      camera: { x: this.#camera.x, y: this.#camera.y, zoom: this.#camera.zoom },
    });
    const viewport = fnWidgetVisibleWorldViewport({
      camera: { x: this.#camera.x, y: this.#camera.y, zoom: this.#camera.zoom },
      viewportWidth: rect.width,
      viewportHeight: rect.height,
    });
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
    const rect = this.#scene.stage.container().getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }

  #syncGhost(request: TWidgetDropRequest, point: TClientPoint): void {
    const bounds = this.resolveWorldBounds(point, request.bounds);
    if (!this.#ghost) {
      const stroke = request.reference.source === "published"
        ? "#2563eb"
        : request.reference.source === "draft" ? "#7c3aed" : "#059669";
      this.#ghost = new Konva.Group({ listening: false, opacity: 0.82 });
      this.#ghost.add(new Konva.Rect({
        name: "widget-placement-ghost-frame",
        stroke,
        strokeWidth: 2 / this.#camera.zoom,
        dash: [8 / this.#camera.zoom, 5 / this.#camera.zoom],
        fill: `${stroke}18`,
        cornerRadius: 10 / this.#camera.zoom,
      }));
      this.#ghost.add(new Konva.Text({
        name: "widget-placement-ghost-label",
        text: `${request.label} · ${request.reference.source === "published" ? "Published" : request.reference.source === "draft" ? "Draft" : "Preview"}`,
        fill: stroke,
        fontSize: 12 / this.#camera.zoom,
        padding: 8 / this.#camera.zoom,
      }));
      this.#scene.dynamicLayer.add(this.#ghost);
    }
    this.#ghost.position({ x: bounds.x, y: bounds.y });
    const frame = this.#ghost.findOne(".widget-placement-ghost-frame");
    if (frame instanceof Konva.Rect) frame.size({ width: bounds.width, height: bounds.height });
    this.#scene.dynamicLayer.batchDraw();
  }

  #markGhostCommitting(request: TWidgetDropRequest): void {
    if (!this.#ghost) return;
    this.#ghost.opacity(0.94);
    const frame = this.#ghost.findOne(".widget-placement-ghost-frame");
    if (frame instanceof Konva.Rect) {
      frame.dash([]);
      frame.fill(request.reference.source === "published" ? "#2563eb24" : "#7c3aed24");
    }
    const label = this.#ghost.findOne(".widget-placement-ghost-label");
    if (label instanceof Konva.Text) {
      label.text(request.reference.source === "published"
        ? `Adding ${request.label}…`
        : `Building ${request.label} Preview…`);
    }
    this.#scene.dynamicLayer.batchDraw();
  }

  async #commitWithGhost(
    request: TWidgetDropRequest,
    clientPoint: TClientPoint,
    ghost: Konva.Group | null,
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

  #destroyGhost(ghost: Konva.Group | null = this.#ghost): void {
    ghost?.destroy();
    if (this.#ghost === ghost) this.#ghost = null;
    this.#scene.dynamicLayer?.batchDraw();
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
