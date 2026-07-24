import type { TCanvasPortalRenderState } from "@vibecanvas/canvas/services";
import type {
  TWidgetCapsuleCanvasLifecycleState,
} from "./interface";
import { fnWidgetCapsuleViewport } from "../widget-runtime/fn.capsule-viewport";

type TArgs = Readonly<{
  viewport: TCanvasPortalRenderState["viewport"];
  focused: boolean;
  collapsed: boolean;
  fullscreen: boolean;
}>;

function fnClamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function fnPriority(args: TArgs, visible: boolean): number {
  if (args.collapsed) {
    return -100;
  }
  if (args.fullscreen) {
    return 100;
  }
  if (args.focused) {
    return 90;
  }
  if (!visible) {
    return -50;
  }
  return args.viewport.interactive ? 60 : 30;
}

export function fnWidgetCapsuleCanvasLifecycle(
  args: TArgs,
): TWidgetCapsuleCanvasLifecycleState {
  const visible = args.viewport.visible && !args.collapsed;
  return Object.freeze({
    viewport: fnWidgetCapsuleViewport({
      width: args.viewport.width,
      height: args.viewport.height,
      scale: args.viewport.scale,
      visibility: visible ? "visible" : "hidden",
      distance: args.viewport.distance,
      priority: fnPriority(args, visible),
      occlusion: visible
        ? args.viewport.occlusion
        : 1,
    }),
    focused: visible && args.focused,
    frozen: args.collapsed,
    collapsed: args.collapsed,
    fullscreen: args.fullscreen,
  });
}
