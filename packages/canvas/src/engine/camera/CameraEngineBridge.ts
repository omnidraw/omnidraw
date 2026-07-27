import type {
  ICamera2DController,
  TAabb,
  TCamera2DState,
  TCameraAnimationOptions,
  TCameraChangeEvent,
  TMat3,
  TSize2,
  TVec2,
} from "@omnidraw/cangine";
import {
  CANVAS_CAMERA_MAX_ZOOM,
  CANVAS_CAMERA_MIN_ZOOM,
} from "./CONSTANTS";
import {
  fnCanvasCameraDegreesToRadians,
  fnCanvasCameraRadiansToDegrees,
  fnEngineCameraToLegacyViewport,
  fnLegacyViewportToEngineCamera,
} from "./fn.camera-state";
import type {
  TCanvasCameraBridgeChangeEvent,
  TCanvasCameraChangeSource,
  TCanvasCameraSnapshot,
  TCanvasLegacyCameraViewport,
} from "./typed";

export type TCameraEngineBridgeArgs = {
  camera: ICamera2DController;
  initialViewport?: TCanvasLegacyCameraViewport;
  initialRotationDegrees?: number;
  cancelAnimationOnStop?: boolean;
};

export type TCameraEngineBridgeSetOptions = {
  rotationDegrees?: number;
  source?: TCameraChangeEvent["source"];
};

export type TCameraEngineBridgeAnimationOptions = TCameraAnimationOptions & {
  rotationDegrees?: number;
};

function freezeViewport(
  viewport: TCanvasLegacyCameraViewport,
): Readonly<TCanvasLegacyCameraViewport> {
  return Object.freeze({
    x: viewport.x,
    y: viewport.y,
    zoom: viewport.zoom,
  });
}

function freezeSize(viewportSize: TSize2): Readonly<TSize2> {
  return Object.freeze({
    width: viewportSize.width,
    height: viewportSize.height,
  });
}

function freezeSnapshot(args: {
  viewport: TCanvasLegacyCameraViewport;
  rotationDegrees: number;
  viewportSize: TSize2;
}): TCanvasCameraSnapshot {
  return Object.freeze({
    viewport: freezeViewport(args.viewport),
    rotationDegrees: args.rotationDegrees,
    viewportSize: freezeSize(args.viewportSize),
  });
}

function snapshotsEqual(
  left: TCanvasCameraSnapshot,
  right: TCanvasCameraSnapshot,
): boolean {
  return left.viewport.x === right.viewport.x
    && left.viewport.y === right.viewport.y
    && left.viewport.zoom === right.viewport.zoom
    && left.rotationDegrees === right.rotationDegrees
    && left.viewportSize.width === right.viewportSize.width
    && left.viewportSize.height === right.viewportSize.height;
}

function clonePoint(point: TVec2): TVec2 {
  return { x: point.x, y: point.y };
}

function cloneBounds(bounds: TAabb): TAabb {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

function cloneMatrix(matrix: TMat3): TMat3 {
  return [
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[4],
    matrix[5],
    matrix[6],
    matrix[7],
    matrix[8],
  ];
}

/**
 * Canvas-owned camera facade. The engine controller stays private so product
 * code only observes legacy viewport state and named coordinate conversions.
 */
export class CameraEngineBridge {
  readonly #camera: ICamera2DController;
  readonly #cancelAnimationOnStop: boolean;
  readonly #listeners = new Set<
    (event: TCanvasCameraBridgeChangeEvent) => void
  >();

  #snapshot: TCanvasCameraSnapshot;
  #initialViewport: TCanvasLegacyCameraViewport | null;
  #initialRotationDegrees = 0;
  #unsubscribeCamera: (() => void) | null = null;
  #sourceOverride: TCanvasCameraChangeSource | null = null;
  #started = false;
  #destroyed = false;

  constructor(args: TCameraEngineBridgeArgs) {
    this.#camera = args.camera;
    this.#cancelAnimationOnStop = args.cancelAnimationOnStop ?? true;

    if (args.initialViewport === undefined) {
      this.#initialViewport = null;
      this.#snapshot = this.#snapshotFromState(
        this.#camera.state,
        this.#camera.viewportSize,
      );
      return;
    }

    const initialState = fnLegacyViewportToEngineCamera({
      viewport: args.initialViewport,
      viewportSize: this.#camera.viewportSize,
      rotationDegrees: args.initialRotationDegrees,
    });
    this.#snapshot = this.#snapshotFromState(
      initialState,
      this.#camera.viewportSize,
    );
    this.#initialViewport = {
      x: this.#snapshot.viewport.x,
      y: this.#snapshot.viewport.y,
      zoom: this.#snapshot.viewport.zoom,
    };
    this.#initialRotationDegrees = this.#snapshot.rotationDegrees;
  }

  get started(): boolean {
    return this.#started;
  }

  get snapshot(): TCanvasCameraSnapshot {
    return this.#snapshot;
  }

  get viewport(): Readonly<TCanvasLegacyCameraViewport> {
    return this.#snapshot.viewport;
  }

  get rotationDegrees(): number {
    return this.#snapshot.rotationDegrees;
  }

  get viewportSize(): Readonly<TSize2> {
    return this.#snapshot.viewportSize;
  }

  start(): void {
    this.#assertNotDestroyed();
    if (this.#started) {
      return;
    }

    this.#camera.setConstraints({
      minZoom: CANVAS_CAMERA_MIN_ZOOM,
      maxZoom: CANVAS_CAMERA_MAX_ZOOM,
      worldBounds: undefined,
    });

    if (this.#initialViewport !== null) {
      this.#camera.set(fnLegacyViewportToEngineCamera({
        viewport: this.#initialViewport,
        viewportSize: this.#camera.viewportSize,
        rotationDegrees: this.#initialRotationDegrees,
      }), { source: "restore" });
      this.#initialViewport = null;
    }

    this.#snapshot = this.#snapshotFromState(
      this.#camera.state,
      this.#camera.viewportSize,
    );
    this.#started = true;
    try {
      this.#unsubscribeCamera = this.#camera.subscribe((event) => {
        this.#onCameraChange(event);
      });
    } catch (error) {
      this.#started = false;
      throw error;
    }
  }

  stop(): void {
    if (!this.#started) {
      return;
    }

    this.#unsubscribeCamera?.();
    this.#unsubscribeCamera = null;
    this.#started = false;
    if (this.#cancelAnimationOnStop) {
      this.#camera.cancelAnimation();
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.stop();
    this.#listeners.clear();
    this.#destroyed = true;
  }

  subscribe(
    listener: (event: TCanvasCameraBridgeChangeEvent) => void,
  ): () => void {
    this.#assertNotDestroyed();
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  setViewport(
    viewport: TCanvasLegacyCameraViewport,
    options: TCameraEngineBridgeSetOptions = {},
  ): void {
    this.#assertStarted();
    const state = fnLegacyViewportToEngineCamera({
      viewport,
      viewportSize: this.#camera.viewportSize,
      rotationDegrees: options.rotationDegrees
        ?? this.#snapshot.rotationDegrees,
    });
    this.#camera.set(
      state,
      options.source === undefined ? {} : { source: options.source },
    );
  }

  set(
    viewport: TCanvasLegacyCameraViewport,
    options: TCameraEngineBridgeSetOptions = {},
  ): void {
    this.setViewport(viewport, options);
  }

  /**
   * Preserves CameraService pan signs: positive deltas move the legacy
   * translation left/up. Pointer displacement can use panByScreen directly.
   */
  pan(deltaX: number, deltaY: number): void {
    this.panByScreen({ x: -deltaX, y: -deltaY });
  }

  panByScreen(delta: TVec2): void {
    this.#assertStarted();
    this.#camera.panByScreen(delta);
  }

  panByWorld(delta: TVec2): void {
    this.#assertStarted();
    this.#camera.panByWorld(delta);
  }

  zoomAtViewportPoint(nextZoom: number, point: TVec2): void {
    this.#assertStarted();
    this.#camera.zoomAtViewportPoint(nextZoom, point);
  }

  zoomAtScreenPoint(nextZoom: number, point: TVec2): void {
    this.zoomAtViewportPoint(nextZoom, point);
  }

  rotateAtViewportPoint(
    rotationDegrees: number,
    point: TVec2,
  ): void {
    this.#assertStarted();
    this.#camera.rotateAtViewportPoint(
      fnCanvasCameraDegreesToRadians({ degrees: rotationDegrees }),
      point,
    );
  }

  animateTo(
    viewport: TCanvasLegacyCameraViewport,
    options: TCameraEngineBridgeAnimationOptions = {},
  ): Promise<void> {
    this.#assertStarted();
    const state = fnLegacyViewportToEngineCamera({
      viewport,
      viewportSize: this.#camera.viewportSize,
      rotationDegrees: options.rotationDegrees
        ?? this.#snapshot.rotationDegrees,
    });
    const animationOptions: TCameraAnimationOptions = {
      ...(options.durationMs === undefined
        ? {}
        : { durationMs: options.durationMs }),
      ...(options.easing === undefined ? {} : { easing: options.easing }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    return this.#camera.animateTo(state, animationOptions);
  }

  cancelAnimation(): void {
    this.#assertStarted();
    this.#camera.cancelAnimation();
  }

  /**
   * Reapply the cached legacy translation after the engine host size changes.
   * The engine center changes, while `{x,y,zoom}` remains stable.
   */
  reapplyViewportSize(): void {
    this.#assertStarted();
    const previous = this.#snapshot;
    const state = fnLegacyViewportToEngineCamera({
      viewport: previous.viewport,
      viewportSize: this.#camera.viewportSize,
      rotationDegrees: previous.rotationDegrees,
    });

    this.#sourceOverride = "viewport-resize";
    try {
      this.#camera.set(state);
    } finally {
      this.#sourceOverride = null;
    }

    const current = this.#snapshotFromState(
      this.#camera.state,
      this.#camera.viewportSize,
    );
    if (!snapshotsEqual(this.#snapshot, current)) {
      this.#commitSnapshot(current, "viewport-resize");
    }
  }

  clientToViewport(point: TVec2): TVec2 {
    this.#assertStarted();
    return clonePoint(this.#camera.clientToViewport(point));
  }

  viewportToClient(point: TVec2): TVec2 {
    this.#assertStarted();
    return clonePoint(this.#camera.viewportToClient(point));
  }

  viewportToWorld(point: TVec2): TVec2 {
    this.#assertStarted();
    return clonePoint(this.#camera.viewportToWorld(point));
  }

  worldToViewport(point: TVec2): TVec2 {
    this.#assertStarted();
    return clonePoint(this.#camera.worldToViewport(point));
  }

  worldToClient(point: TVec2): TVec2 {
    this.#assertStarted();
    return clonePoint(this.#camera.worldToClient(point));
  }

  worldRectToViewport(bounds: TAabb): TAabb {
    this.#assertStarted();
    return cloneBounds(this.#camera.worldRectToViewport(bounds));
  }

  visibleWorldBounds(): TAabb {
    this.#assertStarted();
    return cloneBounds(this.#camera.visibleWorldBounds());
  }

  worldToViewportMatrix(): TMat3 {
    this.#assertStarted();
    return cloneMatrix(this.#camera.worldToViewportMatrix());
  }

  viewportToWorldMatrix(): TMat3 {
    this.#assertStarted();
    return cloneMatrix(this.#camera.viewportToWorldMatrix());
  }

  #snapshotFromState(
    state: TCamera2DState,
    viewportSize: TSize2,
  ): TCanvasCameraSnapshot {
    return freezeSnapshot({
      viewport: fnEngineCameraToLegacyViewport({
        state,
        viewportSize,
      }),
      rotationDegrees: fnCanvasCameraRadiansToDegrees({
        radians: state.rotation,
      }),
      viewportSize,
    });
  }

  #onCameraChange(event: TCameraChangeEvent): void {
    if (!this.#started) {
      return;
    }

    const current = this.#snapshotFromState(
      event.current,
      this.#camera.viewportSize,
    );
    if (snapshotsEqual(this.#snapshot, current)) {
      return;
    }
    this.#commitSnapshot(
      current,
      this.#sourceOverride ?? event.source,
    );
  }

  #commitSnapshot(
    current: TCanvasCameraSnapshot,
    source: TCanvasCameraChangeSource,
  ): void {
    const previous = this.#snapshot;
    if (snapshotsEqual(previous, current)) {
      return;
    }

    this.#snapshot = current;
    const event = Object.freeze({
      previous,
      current,
      source,
    });
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // Observers cannot interrupt the committed engine camera change.
      }
    }
  }

  #assertStarted(): void {
    this.#assertNotDestroyed();
    if (!this.#started) {
      throw new Error("CameraEngineBridge is not started.");
    }
  }

  #assertNotDestroyed(): void {
    if (this.#destroyed) {
      throw new Error("CameraEngineBridge is destroyed.");
    }
  }
}
