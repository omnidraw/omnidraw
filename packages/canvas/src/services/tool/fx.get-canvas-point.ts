import type { SceneService } from "../scene/SceneService";
import type { TEditorToolCanvasPoint, TEditorToolPointerEvent } from "./types";

type TPortal = {
  scene: SceneService;
}
type TArgs = {
  event: TEditorToolPointerEvent;
}
export function fxGetCanvasPoint(portal: TPortal, args: TArgs): TEditorToolCanvasPoint | null {
  const point = portal.scene.dynamicLayer.getRelativePointerPosition();
  if (!point) {
    return null;
  }

  const pressure = typeof args.event.evt.pressure === "number"
    && Number.isFinite(args.event.evt.pressure)
    && args.event.evt.pressure > 0
      ? args.event.evt.pressure
      : 0.5;

  return {
    x: point.x,
    y: point.y,
    pressure,
  };
}
