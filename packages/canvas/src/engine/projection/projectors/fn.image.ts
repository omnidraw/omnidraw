import type { TImageNode } from "@omnidraw/cangine";
import {
  fnCanvasEngineImageResourceId,
} from "../fn.ids";
import {
  fnCanvasElementChildBase,
  fnCanvasElementRootNode,
} from "../fn.nodes";
import { fnResolveCanvasElementStyle } from "../fn.style";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";

export function fnProjectImageElement(
  args: TCanvasElementProjectorArgs,
): TCanvasElementProjectionDraft {
  const data = args.element.data;
  if (data.type !== "image") {
    throw new TypeError("Expected an image element.");
  }
  const sourceUrl = data.url ?? data.base64;
  if (!sourceUrl) {
    throw new TypeError("Image element has no renderable source.");
  }

  const style = fnResolveCanvasElementStyle(args);
  const root = fnCanvasElementRootNode({
    element: args.element,
    parentNodeId: args.parentNodeId,
    opacity: style.opacity,
  });
  const resourceId = fnCanvasEngineImageResourceId({
    id: args.element.id,
    sourceKey: sourceUrl,
  });
  const render: TImageNode = {
    ...fnCanvasElementChildBase({
      elementId: args.element.id,
      child: "render",
    }),
    kind: "image",
    resourceId,
    size: {
      width: Math.max(0, data.w),
      height: Math.max(0, data.h),
    },
    fit: "fill",
    crop: {
      x: data.crop.x,
      y: data.crop.y,
      width: data.crop.width,
      height: data.crop.height,
    },
  };

  return {
    nodes: [root, render],
    resources: [{
      descriptor: {
        id: resourceId,
        type: "image",
        url: sourceUrl,
      },
    }],
  };
}
