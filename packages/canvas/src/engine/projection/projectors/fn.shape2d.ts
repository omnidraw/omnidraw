import type {
  TEllipseNode,
  TPolygonNode,
  TRectNode,
  TSceneNode,
  TTextNode,
} from "@omnidraw/cangine";
import type { TTextData } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import { fnCanvasSolidPaint } from "../fn.color";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
} from "../fn.nodes";
import {
  fnResolveCanvasElementStyle,
  fnResolveCanvasProjectionFontSize,
} from "../fn.style";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";

function inlineTextNode(
  args: TCanvasElementProjectorArgs,
  text: TTextData,
  width: number,
  height: number,
): TTextNode {
  const style = fnResolveCanvasElementStyle(args);
  const fontSize = fnResolveCanvasProjectionFontSize({
    theme: args.theme,
    value: args.element.style.fontSize ?? "@text/m",
    fallback: 20,
  });
  return {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "inline-text",
    }),
    kind: "text",
    runs: [{
      text: text.text,
      metadata: {
        "vibecanvas:original-text": text.originalText,
      },
    }],
    style: {
      fontFamilies: [text.fontFamily],
      fontSize,
      lineHeight: fontSize * 1.2,
      fill: fnCanvasSolidPaint({ color: style.textColor }),
    },
    layout: {
      type: "fixed",
      size: {
        width: Math.max(0, width),
        height: Math.max(0, height),
      },
      overflow: "clip",
    },
    align: args.element.style.textAlign ?? "center",
    verticalAlign: args.element.style.verticalAlign ?? "middle",
    wrap: "word",
    selectable: true,
  };
}

export function fnProjectShape2dElement(
  args: TCanvasElementProjectorArgs,
): TCanvasElementProjectionDraft {
  const data = args.element.data;
  if (data.type !== "rect" && data.type !== "ellipse" && data.type !== "diamond") {
    throw new TypeError("Expected a rect, ellipse, or diamond element.");
  }

  const style = fnResolveCanvasElementStyle(args);
  const root = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const child = fnCanvasElementChildBase({
    elementId: args.element.id,
    child: "render",
  });
  const nodes: TSceneNode[] = [root];

  if (data.type === "rect") {
    const render: TRectNode = {
      ...child,
      kind: "rect",
      size: {
        width: Math.max(0, data.w),
        height: Math.max(0, data.h),
      },
      radius: data.radius ?? style.cornerRadius,
      ...(style.fill === undefined ? {} : { fill: style.fill }),
      ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
    };
    nodes.push(render);
    if (data.text) {
      nodes.push(inlineTextNode(args, data.text, data.w, data.h));
    }
    return { nodes };
  }

  if (data.type === "ellipse") {
    const width = Math.max(0, data.rx * 2);
    const height = Math.max(0, data.ry * 2);
    const render: TEllipseNode = {
      ...child,
      kind: "ellipse",
      size: { width, height },
      ...(style.fill === undefined ? {} : { fill: style.fill }),
      ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
    };
    nodes.push(render);
    if (data.text) {
      nodes.push(inlineTextNode(args, data.text, width, height));
    }
    return { nodes };
  }

  const render: TPolygonNode = {
    ...child,
    kind: "polygon",
    points: [
      { x: data.w / 2, y: 0 },
      { x: data.w, y: data.h / 2 },
      { x: data.w / 2, y: data.h },
      { x: 0, y: data.h / 2 },
    ],
    closed: true,
    ...(style.fill === undefined ? {} : { fill: style.fill }),
    ...(style.stroke === undefined ? {} : { stroke: style.stroke }),
  };
  nodes.push(render);
  if (data.text) {
    nodes.push(inlineTextNode(args, data.text, data.w, data.h));
  }
  return { nodes };
}
