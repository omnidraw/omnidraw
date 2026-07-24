import type { TTextNode } from "@vibecanvas/canvas-engine";
import { fnCanvasSolidPaint } from "../fn.color";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
} from "../fn.nodes";
import { fnResolveCanvasElementStyle } from "../fn.style";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";

export function fnProjectTextElement(
  args: TCanvasElementProjectorArgs,
): TCanvasElementProjectionDraft {
  const data = args.element.data;
  if (data.type !== "text") {
    throw new TypeError("Expected a text element.");
  }

  const style = fnResolveCanvasElementStyle(args);
  const root = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const render: TTextNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "render",
    }),
    kind: "text",
    runs: [{
      text: data.text,
      metadata: {
        "vibecanvas:original-text": data.originalText,
      },
    }],
    style: {
      fontFamilies: [data.fontFamily],
      fontSize: style.fontSize,
      lineHeight: style.fontSize * 1.2,
      fill: fnCanvasSolidPaint({ color: style.textColor }),
    },
    layout: data.autoResize
      ? {
          type: "auto-width",
          maxWidth: Math.max(1, data.w),
        }
      : {
          type: "fixed",
          size: {
            width: Math.max(0, data.w),
            height: Math.max(0, data.h),
          },
          overflow: "clip",
        },
    align: style.textAlign,
    verticalAlign: style.verticalAlign,
    wrap: "none",
    selectable: true,
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.element.id,
      "vibecanvas:derived": true,
      "vibecanvas:container-id": data.containerId,
      "vibecanvas:link": data.link,
    },
  };
  return {
    nodes: [root, render],
  };
}
