import type {
  TGroupNode,
  TNodeBase,
  TTransform2D,
} from "@vibecanvas/canvas-engine";
import type {
  TElement,
  TGroup,
} from "@vibecanvas/service-automerge/types/canvas-doc.types";
import {
  CANVAS_ENGINE_ORDER_KEYS,
} from "../CONSTANTS";
import {
  fnCanvasEngineElementChildId,
  fnCanvasEngineElementId,
  fnCanvasEngineGroupId,
} from "./fn.ids";
import { fnDegreesToRadians } from "./fn.units";

type TArgsElementRootNode = {
  element: TElement;
  parentNodeId: string;
  opacity: number;
  placeholder?: boolean;
};

type TArgsElementChildBase = {
  elementId: string;
  child: "render" | "inline-text" | "placeholder-frame" | "placeholder-text";
};

type TArgsGroupNode = {
  group: TGroup;
  parentNodeId: string;
};

type TArgsElementLocalSize = {
  element: TElement;
};

export function fnCanvasIdentityTransform2D(): TTransform2D {
  return {
    position: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
    skew: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
  };
}

export function fnCanvasElementRootNode(args: TArgsElementRootNode): TGroupNode {
  const origin = args.element.data.type === "ellipse"
    ? {
        x: args.element.data.rx,
        y: args.element.data.ry,
      }
    : { x: 0, y: 0 };
  return {
    id: fnCanvasEngineElementId({ id: args.element.id }),
    kind: "group",
    parentId: args.parentNodeId,
    orderKey: args.element.zIndex,
    transform: {
      ...fnCanvasIdentityTransform2D(),
      position: {
        x: args.element.x,
        y: args.element.y,
      },
      rotation: fnDegreesToRadians({ angle: args.element.rotation }),
      scale: {
        x: args.element.scaleX ?? 1,
        y: args.element.scaleY ?? 1,
      },
      origin,
    },
    opacity: args.opacity,
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.element.id,
      "vibecanvas:element-type": args.element.data.type,
      "vibecanvas:locked": args.element.locked,
      "vibecanvas:placeholder": args.placeholder ?? false,
    },
  };
}

export function fnCanvasElementChildBase(args: TArgsElementChildBase): Pick<
  TNodeBase,
  "id" | "parentId" | "orderKey" | "transform" | "metadata"
> {
  const orderKey = args.child === "inline-text" || args.child === "placeholder-text"
    ? CANVAS_ENGINE_ORDER_KEYS.elementInlineText
    : CANVAS_ENGINE_ORDER_KEYS.elementRender;

  return {
    id: fnCanvasEngineElementChildId({
      id: args.elementId,
      child: args.child,
    }),
    parentId: fnCanvasEngineElementId({ id: args.elementId }),
    orderKey,
    transform: fnCanvasIdentityTransform2D(),
    metadata: {
      "vibecanvas:target-kind": "element",
      "vibecanvas:element-id": args.elementId,
      "vibecanvas:derived": true,
    },
  };
}

export function fnCanvasGroupNode(args: TArgsGroupNode): TGroupNode {
  return {
    id: fnCanvasEngineGroupId({ id: args.group.id }),
    kind: "group",
    parentId: args.parentNodeId,
    orderKey: args.group.zIndex,
    transform: fnCanvasIdentityTransform2D(),
    metadata: {
      "vibecanvas:target-kind": "group",
      "vibecanvas:group-id": args.group.id,
      "vibecanvas:locked": args.group.locked,
    },
  };
}

export function fnCanvasElementLocalSize(args: TArgsElementLocalSize): {
  width: number;
  height: number;
} {
  const data = args.element.data;
  if (
    data.type === "rect"
    || data.type === "diamond"
    || data.type === "text"
    || data.type === "image"
    || data.type === "ui-widget"
    || data.type === "widget-instance"
  ) {
    return {
      width: Math.max(0, data.w),
      height: Math.max(0, data.h),
    };
  }
  if (data.type === "ellipse") {
    return {
      width: Math.max(0, data.rx * 2),
      height: Math.max(0, data.ry * 2),
    };
  }
  if (data.type === "line" || data.type === "arrow" || data.type === "pen") {
    const points = data.points;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    if (xs.length === 0 || ys.length === 0) {
      return { width: 0, height: 0 };
    }
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  return { width: 0, height: 0 };
}
