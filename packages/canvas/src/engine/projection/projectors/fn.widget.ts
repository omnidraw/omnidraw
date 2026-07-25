import type { TWidgetFrameNode } from "@omnidraw/cangine";
import type {
  TCanvasJsonValue,
  TCanvasProjectedPortalContent,
} from "../../typed";
import { CANVAS_PROJECTION_WIDGET } from "../CONSTANTS";
import { fnResolveCanvasProjectionColor } from "../fn.color";
import {
  fnCanvasEngineElementChildId,
  fnCanvasEnginePortalId,
} from "../fn.ids";
import { fnCloneCanvasJsonValue } from "../fn.json";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
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
      ...(data.uiProps === undefined ? {} : { uiProps: cloneRecord(data.uiProps) }),
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
  const root = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const frameNodeId = fnCanvasEngineElementChildId({
    id: args.element.id,
    child: "render",
  });
  const portalId = fnCanvasEnginePortalId({ id: args.element.id });
  const isUiWidget = data.type === "ui-widget";
  const titleBarColor = isUiWidget
    ? args.theme.colors.accent
    : args.theme.colors.muted;
  const collapsed = data.expanded === false;
  const size = {
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
    titleBarColor: fnResolveCanvasProjectionColor({
      theme: args.theme,
      value: titleBarColor,
    }),
    portal: {
      portalId,
      scaleMode: "world",
      interactive: true,
      suspendWhenOffscreen: true,
    },
    collapsed,
    resizable: true,
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.element.id,
      "vibecanvas:derived": true,
      "vibecanvas:widget-type": data.type,
    },
  };

  return {
    nodes: [root, render],
    portals: [{
      portalId,
      nodeId: frameNodeId,
      elementId: args.element.id,
      scaleMode: "world",
      interactive: true,
      suspendWhenOffscreen: true,
      content: portalContent(args),
    }],
  };
}
