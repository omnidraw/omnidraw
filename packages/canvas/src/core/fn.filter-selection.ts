import type Konva from "konva";
import { isCanvasGroupNode } from "./GUARDS";

export type TArgsFilterSelection = {
  selection: Array<Konva.Node>;
};

export function fnFilterSelection(
  args: TArgsFilterSelection,
) {
  let subSelection = args.selection.find((node) => {
    const parent = node.getParent();
    return parent && isCanvasGroupNode(parent);
  });

  if (!subSelection) {
    return args.selection.filter((node) => node.getStage() !== null);
  }

  const findDeepestSubSelection = () => {
    const deeperSubSelection = args.selection.find((node) => node.getParent() === subSelection);
    if (!deeperSubSelection) {
      return;
    }

    subSelection = deeperSubSelection;
    findDeepestSubSelection();
  };

  findDeepestSubSelection();

  return subSelection && subSelection.getStage() !== null ? [subSelection] : [];
}
