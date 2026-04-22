import type { Node } from "konva/lib/Node";
import { fnIsCanvasGroupNode } from "../../core/fn.canvas-node-semantics";
import type { ElementService, TCanvasTransformAnchor } from "../../services";
import { fxIsShape1dNode } from "../shape1d/fx.node";

const GROUP_ANCHORS: TCanvasTransformAnchor[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const DEFAULT_ANCHORS: TCanvasTransformAnchor[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "middle-left",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

type TPortalFxGetSelectionTransformOptions = {
  element: ElementService;
  Konva: typeof Konva;
};

type TArgsFxGetSelectionTransformOptions = {
  selection: Array<Node>;
};

export function fxGetSelectionTransformOptions(portal: TPortalFxGetSelectionTransformOptions, args: TArgsFxGetSelectionTransformOptions) {
  const isSingleGroupSelection = args.selection.length === 1
    && fnIsCanvasGroupNode(args.selection[0]);
  const isMultiSelection = args.selection.length > 1;
  const hasTextOnly = args.selection.length > 0 && args.selection.every((node) => node instanceof portal.Konva.Text);
  const hasShape1dOnly = args.selection.length > 0 && args.selection.every((node) => fxIsShape1dNode({ Shape: portal.Konva.Shape }, { node }));

  const defaultUseCornerAnchors = isSingleGroupSelection || hasTextOnly || hasShape1dOnly || isMultiSelection;
  let enabledAnchors: TCanvasTransformAnchor[] = defaultUseCornerAnchors ? [...GROUP_ANCHORS] : [...DEFAULT_ANCHORS];
  let keepRatio = defaultUseCornerAnchors;
  let flipEnabled = true;

  for (const node of args.selection) {
    const transformOptions = portal.element.getTransformOptions({
      node,
      selection: args.selection,
    });

    if (args.selection.length === 1 && transformOptions.enabledAnchors) {
      enabledAnchors = [...transformOptions.enabledAnchors];
    }
    if (transformOptions.keepRatio === true) {
      keepRatio = true;
    }
    if (args.selection.length === 1 && transformOptions.keepRatio === false) {
      keepRatio = false;
    }
    if (transformOptions.flipEnabled === false) {
      flipEnabled = false;
    }
    if (args.selection.length === 1 && transformOptions.flipEnabled === true) {
      flipEnabled = true;
    }
  }

  return {
    borderEnabled: !isSingleGroupSelection,
    borderDash: isMultiSelection ? [2, 2] : [0, 0],
    enabledAnchors,
    keepRatio,
    flipEnabled,
  };
}
