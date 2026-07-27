import type {
  IService,
  IStartableService,
  IStoppableService,
} from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";
import type { TCanvasPoint } from "../../semantic/typed";
import type { SceneService } from "../scene/SceneService";

export type TCameraServiceArgs = {
  scene: SceneService;
};

export type TCameraViewport = {
  x: number;
  y: number;
  zoom: number;
};

interface TCameraServiceHooks {
  change: SyncHook<[]>;
}

/**
 * Product camera facade. Its public `{x,y,zoom}` model remains unchanged while
 * all matrices and coordinate conversion are delegated to canvas-engine.
 */
export class CameraService
implements
  IService<TCameraServiceHooks>,
  IStartableService,
  IStoppableService {
  readonly name = "camera";
  readonly hooks: TCameraServiceHooks = {
    change: new SyncHook(),
  };

  readonly scene: SceneService;
  started = false;
  x = 0;
  y = 0;
  zoom = 1;

  #removeCameraListener: (() => void) | null = null;
  #suppressChange = false;

  constructor(args: TCameraServiceArgs) {
    this.scene = args.scene;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.#sync();
    this.#removeCameraListener = this.scene.camera.subscribe(() => {
      this.#sync();
      if (!this.#suppressChange) {
        this.hooks.change.call();
      }
    });
    this.started = true;
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    this.#removeCameraListener?.();
    this.#removeCameraListener = null;
    this.started = false;
  }

  pan(deltaX: number, deltaY: number): void {
    this.scene.camera.pan(deltaX, deltaY);
  }

  zoomAtScreenPoint(scale: number, screenPoint: TCanvasPoint): void {
    this.scene.camera.zoomAtScreenPoint(scale, screenPoint);
  }

  setViewport(
    viewport: TCameraViewport,
    options?: { emitChange?: boolean; force?: boolean },
  ): void {
    void options?.force;
    this.#suppressChange = options?.emitChange === false;
    try {
      this.scene.camera.setViewport(viewport);
      this.#sync();
    } finally {
      this.#suppressChange = false;
    }
  }

  clientToViewport(point: TCanvasPoint): TCanvasPoint {
    return this.scene.camera.clientToViewport(point);
  }

  viewportToClient(point: TCanvasPoint): TCanvasPoint {
    return this.scene.camera.viewportToClient(point);
  }

  viewportToWorld(point: TCanvasPoint): TCanvasPoint {
    return this.scene.camera.viewportToWorld(point);
  }

  worldToViewport(point: TCanvasPoint): TCanvasPoint {
    return this.scene.camera.worldToViewport(point);
  }

  worldToClient(point: TCanvasPoint): TCanvasPoint {
    return this.scene.camera.worldToClient(point);
  }

  visibleWorldBounds() {
    return this.scene.camera.visibleWorldBounds();
  }

  #sync(): void {
    const viewport = this.scene.camera.viewport;
    this.x = viewport.x;
    this.y = viewport.y;
    this.zoom = viewport.zoom;
  }
}
