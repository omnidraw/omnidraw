import type { TCanvasProjectionIndex } from "../typed";

export type TCanvasNodePositionEdit = Readonly<{
  position: number;
  delta: number;
}>;

export function fnResolveCanvasProjectionNodePosition(args: {
  index: Pick<
    TCanvasProjectionIndex,
    "nodePositionEdits" | "nodePositionEpochs" | "nodePositions"
  >;
  nodeId: string;
}): number | undefined {
  let position = args.index.nodePositions?.[args.nodeId];
  if (position === undefined) {
    return undefined;
  }
  const epoch = args.index.nodePositionEpochs?.[args.nodeId] ?? 0;
  for (
    let editIndex = epoch;
    editIndex < (args.index.nodePositionEdits?.length ?? 0);
    editIndex += 1
  ) {
    const edit = args.index.nodePositionEdits![editIndex]!;
    if (edit.delta < 0 && position > edit.position) {
      position += edit.delta;
    } else if (edit.delta > 0 && position >= edit.position) {
      position += edit.delta;
    }
  }
  return position;
}
