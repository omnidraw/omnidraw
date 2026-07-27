import type { TSerializedSceneCommand } from "@omnidraw/cangine";
import type {
  TCanvasDocumentProjection,
  TCanvasProjectionDiff,
} from "../typed";
import { fnResolveCanvasProjectionNodePosition } from "../projection/fn.node-position";

type TArgs = {
  previous: TCanvasDocumentProjection;
  next: TCanvasDocumentProjection;
  diff: TCanvasProjectionDiff;
};

/**
 * Produces one deterministic retained-scene command batch. Removed descendants
 * precede ancestors; every upsert follows its next-scene parent.
 */
export function fnCanvasProjectionCommands(
  args: TArgs,
): TSerializedSceneCommand[] {
  const previousFallbackOrder = new Map(
    args.diff.nodes.removed.map((nodeId, index) => [nodeId, index]),
  );
  const removals = [...new Set(args.diff.nodes.removed)]
    .sort((left, right) => {
      const leftPosition = fnResolveCanvasProjectionNodePosition({
        index: args.previous.index,
        nodeId: left,
      });
      const rightPosition = fnResolveCanvasProjectionNodePosition({
        index: args.previous.index,
        nodeId: right,
      });
      if (leftPosition !== undefined && rightPosition !== undefined) {
        return rightPosition - leftPosition || left.localeCompare(right);
      }
      return (previousFallbackOrder.get(left) ?? 0)
        - (previousFallbackOrder.get(right) ?? 0)
        || left.localeCompare(right);
    })
    .map<TSerializedSceneCommand>((nodeId) => ({
      type: "remove",
      nodeId,
      descendants: "remove",
    }));

  const upsertById = new Map([
    ...args.diff.nodes.added,
    ...args.diff.nodes.updated,
  ].map((node) => [node.id, node]));
  const nextFallbackOrder = new Map(
    [...upsertById].map(([nodeId], index) => [nodeId, index]),
  );
  const upserts = [...upsertById.values()]
    .sort((left, right) => {
      const leftPosition = fnResolveCanvasProjectionNodePosition({
        index: args.next.index,
        nodeId: left.id,
      }) ?? nextFallbackOrder.get(left.id) ?? 0;
      const rightPosition = fnResolveCanvasProjectionNodePosition({
        index: args.next.index,
        nodeId: right.id,
      }) ?? nextFallbackOrder.get(right.id) ?? 0;
      return leftPosition - rightPosition || left.id.localeCompare(right.id);
    })
    .map<TSerializedSceneCommand>((node) => ({
      type: "upsert",
      node,
    }));

  return [...removals, ...upserts];
}
