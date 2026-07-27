import type { TWidgetFrameNode } from "@omnidraw/cangine";
import type { TElementWidgetFrame } from "../../../services/element/types";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";
import { fnProjectWidgetElement } from "./fn.widget";

type TArgs = Readonly<{
  projection: TCanvasElementProjectorArgs;
  frame: TElementWidgetFrame;
}>;

/**
 * Adds product title/header descriptors to Cangine's fixed widget frame.
 * Geometry and all remaining chrome stay engine-owned.
 */
export function fnProjectWidgetElementWithFrame(
  args: TArgs,
): TCanvasElementProjectionDraft {
  const projected = fnProjectWidgetElement(args.projection);
  return {
    ...projected,
    nodes: projected.nodes.map((node) => {
      if (node.kind !== "widget-frame") {
        return node;
      }
      const frame: TWidgetFrameNode = {
        ...node,
        ...(args.frame.title === undefined
          ? {}
          : { title: args.frame.title }),
        ...(args.frame.headerItems === undefined
          ? {}
          : {
              headerItems: args.frame.headerItems.map((item) => {
                return item.type === "dropdown"
                  ? {
                      ...item,
                      content: { ...item.content },
                      items: item.items.map((menuItem) => ({ ...menuItem })),
                    }
                  : {
                      ...item,
                      content: { ...item.content },
                    };
              }),
            }),
      };
      return frame;
    }),
  };
}
