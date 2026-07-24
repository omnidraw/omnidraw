import type {
  TCameraChangeEvent,
  TSize2,
} from "@vibecanvas/canvas-engine";

export type TCanvasLegacyCameraViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type TCanvasCameraZoomConstraints = {
  minZoom?: number;
  maxZoom?: number;
};

export type TCanvasCameraSnapshot = Readonly<{
  viewport: Readonly<TCanvasLegacyCameraViewport>;
  rotationDegrees: number;
  viewportSize: Readonly<TSize2>;
}>;

export type TCanvasCameraChangeSource =
  | TCameraChangeEvent["source"]
  | "viewport-resize";

export type TCanvasCameraBridgeChangeEvent = Readonly<{
  previous: TCanvasCameraSnapshot;
  current: TCanvasCameraSnapshot;
  source: TCanvasCameraChangeSource;
}>;
