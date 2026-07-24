import type { TWidgetFrameNode } from "@vibecanvas/canvas-engine";
import type {
  TCanvasJsonValue,
  TCanvasProjectedPortalContent,
} from "../../typed";
import {
  CANVAS_PROJECTION_WIDGET,
} from "../CONSTANTS";
import {
  fnCanvasSolidPaint,
  fnResolveCanvasProjectionColor,
} from "../fn.color";
import {
  fnCanvasEngineElementChildId,
  fnCanvasEnginePortalId,
} from "../fn.ids";
import { fnCloneCanvasJsonValue } from "../fn.json";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
  fnCanvasIdentityTransform2D,
} from "../fn.nodes";
import { fnResolveCanvasElementStyle } from "../fn.style";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";

function cloneRecord(value: unknown): Record<string, TCanvasJsonValue> {
  return fnCloneCanvasJsonValue({ value }) as Record<string, TCanvasJsonValue>;
}

function portalContent(args: TCanvasElementProjectorArgs): TCanvasProjectedPortalContent {
  const data = args.element.data;
  if (data.type === "ui-widget") {
    return {
      type: "ui-widget",
      kind: data.kind,
      ...(data.payload === undefined ? {} : { payload: cloneRecord(data.payload) }),
      ...(data.uiProps === undefined ? {} : { uiProps: cloneRecord(data.uiProps) }),
    };
  }
  if (data.type === "widget-instance") {
    return {
      type: "widget-instance",
      definitionId: data.definitionId,
      revisionId: data.revisionId,
      instanceId: data.instanceId,
      ...(data.stateDocumentId === undefined
        ? {}
        : { stateDocumentId: data.stateDocumentId }),
    };
  }
  throw new TypeError("Expected a widget element.");
}

export function fnProjectWidgetElement(
  args: TCanvasElementProjectorArgs,
): TCanvasElementProjectionDraft {
  const data = args.element.data;
  if (data.type !== "ui-widget" && data.type !== "widget-instance") {
    throw new TypeError("Expected a UI widget or widget instance element.");
  }

  const style = fnResolveCanvasElementStyle(args);
  const fullscreen = data.window === "fullscreen";
  const projectedRoot = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const root = fullscreen
    ? {
        ...projectedRoot,
        transform: fnCanvasIdentityTransform2D(),
      }
    : projectedRoot;
  const frameNodeId = fnCanvasEngineElementChildId({
    id: args.element.id,
    child: "render",
  });
  const portalId = fnCanvasEnginePortalId({ id: args.element.id });
  const isUiWidget = data.type === "ui-widget";
  const titleBarColor = isUiWidget
    ? args.theme.colors.accent
    : args.theme.colors.muted;
  const titleColor = isUiWidget
    ? args.theme.colors.accentForeground
    : args.theme.colors.mutedForeground;
  const collapsed = !fullscreen
    && (data.expanded === false || data.window === "minimized");
  const viewportSize = args.dependencies.getViewportSize?.();
  const size = fullscreen
    ? {
        width: Math.max(
          CANVAS_PROJECTION_WIDGET.minWidth,
          viewportSize?.width ?? data.w,
        ),
        height: Math.max(
          CANVAS_PROJECTION_WIDGET.minHeight,
          viewportSize?.height ?? data.h,
        ),
      }
    : {
        width: Math.max(CANVAS_PROJECTION_WIDGET.minWidth, data.w),
        height: Math.max(CANVAS_PROJECTION_WIDGET.minHeight, data.h),
      };
  const render: TWidgetFrameNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "render",
    }),
    kind: "widget-frame",
    size,
    title: isUiWidget
      ? data.kind
      : `Widget ${data.definitionId.slice(0, 8)}`,
    controls: [
      { id: "close", kind: "close", label: "Close", side: "left" },
      collapsed
        ? { id: "minimize", kind: "restore", label: "Restore", side: "left" }
        : { id: "minimize", kind: "minimize", label: "Minimize", side: "left" },
      fullscreen
        ? {
            id: "maximize",
            kind: "restore",
            label: "Exit fullscreen",
            side: "left",
          }
        : { id: "maximize", kind: "maximize", label: "Maximize", side: "left" },
      { id: "menu", kind: "menu", label: "Menu", side: "right" },
    ],
    style: {
      background: fnCanvasSolidPaint({
        color: fnResolveCanvasProjectionColor({
          theme: args.theme,
          value: args.theme.colors.card,
        }),
      }),
      border: {
        paint: fnCanvasSolidPaint({
          color: fnResolveCanvasProjectionColor({
            theme: args.theme,
            value: args.theme.colors.border,
          }),
        }),
        width: 1,
      },
      titleBarBackground: fnCanvasSolidPaint({
        color: fnResolveCanvasProjectionColor({
          theme: args.theme,
          value: titleBarColor,
        }),
      }),
      titleColor: fnResolveCanvasProjectionColor({
        theme: args.theme,
        value: titleColor,
      }),
      cornerRadius: CANVAS_PROJECTION_WIDGET.cornerRadius,
      titleBarHeight: CANVAS_PROJECTION_WIDGET.titleBarHeight,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      activeOutline: {
        paint: fnCanvasSolidPaint({
          color: fnResolveCanvasProjectionColor({
            theme: args.theme,
            value: args.theme.colors.canvasSelectionStroke ?? args.theme.colors.ring,
          }),
        }),
        width: 2,
      },
    },
    portal: {
      portalId,
      scaleMode: fullscreen ? "screen-fixed" : "world",
      interactive: true,
      suspendWhenOffscreen: true,
    },
    collapsed,
    resizable: !fullscreen,
    minSize: {
      width: CANVAS_PROJECTION_WIDGET.minWidth,
      height: CANVAS_PROJECTION_WIDGET.minHeight,
    },
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.element.id,
      "vibecanvas:derived": true,
      "vibecanvas:widget-type": data.type,
      "vibecanvas:widget-window": data.window,
    },
  };

  return {
    nodes: [root, render],
    portals: [{
      portalId,
      nodeId: frameNodeId,
      elementId: args.element.id,
      scaleMode: fullscreen ? "screen-fixed" : "world",
      interactive: true,
      suspendWhenOffscreen: true,
      content: portalContent(args),
    }],
  };
}
