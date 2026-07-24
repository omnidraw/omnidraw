import type {
  TWidgetFrameControl,
  TWidgetFrameNode,
} from "@omnidraw/cangine";
import type { TElementWidgetChrome } from "../../../services/element/types";
import type {
  TCanvasElementProjectionDraft,
  TCanvasElementProjectorArgs,
} from "../typed";
import { fnProjectWidgetElement } from "./fn.widget";

type TArgs = Readonly<{
  projection: TCanvasElementProjectorArgs;
  chrome: TElementWidgetChrome;
}>;

function fnWidgetChromeControls(args: Readonly<{
  controls: readonly TWidgetFrameControl[];
  chrome: TElementWidgetChrome;
}>): TWidgetFrameControl[] {
  return [
    ...args.controls,
    ...(args.chrome.actions ?? []).map((action) => ({
      id: action.id,
      kind: action.kind ?? "menu",
      label: action.label,
      side: "right" as const,
      ...(action.disabled === undefined
        ? {}
        : { disabled: action.disabled }),
      ...(action.visible === undefined
        ? {}
        : { visible: action.visible }),
    })),
  ];
}

/**
 * Applies renderer-neutral application chrome to the built-in widget
 * projection. The returned title and controls remain engine-owned.
 */
export function fnProjectWidgetElementWithChrome(
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
        ...(args.chrome.title === undefined
          ? {}
          : { title: args.chrome.title }),
        ...(args.chrome.active === undefined
          ? {}
          : { active: args.chrome.active }),
        controls: fnWidgetChromeControls({
          controls: node.controls ?? [],
          chrome: args.chrome,
        }),
      };
      return frame;
    }),
  };
}
