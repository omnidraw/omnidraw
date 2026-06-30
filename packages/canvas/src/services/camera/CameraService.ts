import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";
import type { SceneService } from ".."

export type TCameraServiceArgs = {
  scene: SceneService;
};

export type TCameraViewport = {
  x: number;
  y: number;
  zoom: number;
};

/**
 * Holds canvas camera state and camera operations.
 * Wraps the current camera implementation behind a service.
 */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

interface TCameraServiceHooks {
  change: SyncHook<[]>;
}

export class CameraService implements IService<TCameraServiceHooks>, IStartableService, IStoppableService {
  readonly name = "camera";

  readonly scene: SceneService;
  readonly hooks: TCameraServiceHooks = {
    change: new SyncHook(),
  };

  started = false;
  x = 0;
  y = 0;
  zoom = 1;

  constructor(args: TCameraServiceArgs) {
    this.scene = args.scene;
  }

  start(): void | Promise<void> {
    if (this.started) {
      return;
    }

    this.setViewport({ x: 0, y: 0, zoom: 1 }, { emitChange: false, force: true });
    this.started = true;
  }

  stop(): void | Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;
  }

  pan(deltaX: number, deltaY: number) {
    const nextX = this.x - deltaX;
    const nextY = this.y - deltaY;

    this.setViewport({ x: nextX, y: nextY, zoom: this.zoom });
  }

  zoomAtScreenPoint(scale: number, screenPoint: { x: number; y: number }) {
    const nextZoom = clampZoom(scale);
    const worldPoint = {
      x: (screenPoint.x - this.x) / this.zoom,
      y: (screenPoint.y - this.y) / this.zoom,
    };
    const nextX = screenPoint.x - worldPoint.x * nextZoom;
    const nextY = screenPoint.y - worldPoint.y * nextZoom;

    this.setViewport({ x: nextX, y: nextY, zoom: nextZoom });
  }

  setViewport(viewport: TCameraViewport, options?: { emitChange?: boolean; force?: boolean }) {
    const nextZoom = clampZoom(viewport.zoom);
    const shouldUpdatePosition = options?.force === true || this.x !== viewport.x || this.y !== viewport.y;
    const shouldUpdateZoom = options?.force === true || this.zoom !== nextZoom;

    this.x = viewport.x;
    this.y = viewport.y;
    this.zoom = nextZoom;
    if (shouldUpdatePosition) {
      this.#updatePosition({ x: viewport.x, y: viewport.y });
    }
    if (shouldUpdateZoom) {
      this.#updateZoom(nextZoom);
    }

    if (options?.emitChange === false) {
      return;
    }

    this.hooks.change.call();
  }

  #updatePosition(position: { x: number; y: number }) {
    this.scene.dynamicLayer.position(position);
    this.scene.staticForegroundLayer.position(position);
    this.scene.dynamicLayer.batchDraw();
    this.scene.staticForegroundLayer.batchDraw();
  }

  #updateZoom(zoom: number) {
    this.scene.dynamicLayer.scale({ x: zoom, y: zoom });
    this.scene.staticForegroundLayer.scale({ x: zoom, y: zoom });
    this.scene.dynamicLayer.batchDraw();
    this.scene.staticForegroundLayer.batchDraw();
  }
}
