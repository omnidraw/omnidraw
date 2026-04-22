import type { TSceneNode } from "./fn.scene-node";

export type TArgsGetSelectionBounds = {
  selection: TSceneNode[];
};

export function fnGetSelectionBounds(args: TArgsGetSelectionBounds) {
  const boxes = args.selection.map((node) => {
    return node.getClientRect({
      skipTransform: false,
      skipShadow: true,
      skipStroke: false,
    });
  });
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}
