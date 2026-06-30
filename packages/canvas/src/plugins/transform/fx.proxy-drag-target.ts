import type Konva from "konva";
import type { Shape, ShapeConfig } from "konva/lib/Shape";
import type { SelectionService, ElementService } from "../../services";
import { fnFilterSelection } from "../../core/fn.filter-selection";
import { fxIsShape1dNode } from "../shape1d/fx.node";

type TPortalFxGetProxyDragTarget = {
  element: ElementService;
  Konva: typeof Konva;
};

type TArgsFxGetProxyDragTarget = {
  selection: SelectionService;
};

export function fxGetProxyDragTarget(portal: TPortalFxGetProxyDragTarget, args: TArgsFxGetProxyDragTarget) {
  if (args.selection.mode !== "select") {
    return null;
  }

  const rawSelection = args.selection.selection;
  const filteredSelection = fnFilterSelection({
    selection: rawSelection,
  });

  if (rawSelection.length !== 1 || filteredSelection.length !== 1) {
    return null;
  }

  const rawNode = rawSelection[0];
  const filteredNode = filteredSelection[0];
  if (!rawNode || rawNode !== filteredNode) {
    return null;
  }

  if (!(rawNode instanceof portal.Konva.Shape)) {
    return null;
  }

  if (fxIsShape1dNode({}, { node: rawNode })) {
    return rawNode as Shape<ShapeConfig>;
  }

  const pathNode = rawNode as unknown as Konva.Node;
  if (!(pathNode instanceof portal.Konva.Path)) {
    return null;
  }

  const element = portal.element.toElement(pathNode);
  return element?.data.type === "pen"
    ? rawNode as Shape<ShapeConfig>
    : null;
}
