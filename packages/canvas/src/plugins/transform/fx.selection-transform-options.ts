import type Konva from "konva";
import type { Node } from "konva/lib/Node";
import { isCanvasGroupNode } from "../../core/GUARDS";
import type { ElementService, TElementTransformAnchor, TElementTransformOptions } from "../../services";
import { fxIsShape1dNode } from "../shape1d/fx.node";

const GROUP_ANCHORS: TElementTransformAnchor[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const DEFAULT_ANCHORS: TElementTransformAnchor[] = [
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
    && isCanvasGroupNode(args.selection[0]);
  const isMultiSelection = args.selection.length > 1;
  const hasTextOnly = args.selection.length > 0 && args.selection.every((node) => node instanceof portal.Konva.Text);
  const hasShape1dOnly = args.selection.length > 0 && args.selection.every((node) => fxIsShape1dNode({}, { node }));

  const defaultUseCornerAnchors = isSingleGroupSelection || hasTextOnly || hasShape1dOnly || isMultiSelection;
  let enabledAnchors: TElementTransformAnchor[] = defaultUseCornerAnchors ? [...GROUP_ANCHORS] : [...DEFAULT_ANCHORS];
  let keepRatio = defaultUseCornerAnchors;
  let flipEnabled = true;
  let boundBoxFunc: TElementTransformOptions["boundBoxFunc"];

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
    if (args.selection.length === 1 && transformOptions.boundBoxFunc) {
      boundBoxFunc = transformOptions.boundBoxFunc;
    }
  }

  return {
    borderEnabled: !isSingleGroupSelection,
    borderDash: isMultiSelection ? [2, 2] : [0, 0],
    enabledAnchors,
    keepRatio,
    flipEnabled,
    boundBoxFunc,
  };
}
