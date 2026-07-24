import type {
  TSceneNode,
  TSerializedSceneCommand,
} from "@vibecanvas/canvas-engine";
import type {
  TCanvasDocumentProjection,
  TCanvasProjectionDiff,
} from "../typed";

type TArgs = {
  previous: TCanvasDocumentProjection;
  next: TCanvasDocumentProjection;
  diff: TCanvasProjectionDiff;
};

function nodeDepth(
  node: TSceneNode,
  nodesById: ReadonlyMap<string, TSceneNode>,
): number {
  let depth = 0;
  let parentId = node.parentId;
  const visited = new Set<string>([node.id]);
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodesById.get(parentId);
    if (parent === undefined) {
      break;
    }
    depth += 1;
    parentId = parent.parentId;
  }
  return depth;
}

function compareByDepthAndSnapshotOrder(args: {
  left: TSceneNode;
  right: TSceneNode;
  nodesById: ReadonlyMap<string, TSceneNode>;
  snapshotOrder: ReadonlyMap<string, number>;
  deepestFirst: boolean;
}): number {
  const leftDepth = nodeDepth(args.left, args.nodesById);
  const rightDepth = nodeDepth(args.right, args.nodesById);
  const depthOrder = args.deepestFirst
    ? rightDepth - leftDepth
    : leftDepth - rightDepth;
  return depthOrder
    || (args.snapshotOrder.get(args.left.id) ?? 0)
      - (args.snapshotOrder.get(args.right.id) ?? 0)
    || args.left.id.localeCompare(args.right.id);
}

/**
 * Produces one deterministic retained-scene command batch. Removed descendants
 * precede ancestors; every upsert follows its next-scene parent.
 */
export function fnCanvasProjectionCommands(
  args: TArgs,
): TSerializedSceneCommand[] {
  const previousNodes = new Map(
    args.previous.snapshot.nodes.map((node) => [node.id, node]),
  );
  const previousOrder = new Map(
    args.previous.snapshot.nodes.map((node, index) => [node.id, index]),
  );
  const nextNodes = new Map(
    args.next.snapshot.nodes.map((node) => [node.id, node]),
  );
  const nextOrder = new Map(
    args.next.snapshot.nodes.map((node, index) => [node.id, index]),
  );

  const removals = args.diff.nodes.removed
    .map((nodeId) => previousNodes.get(nodeId))
    .filter((node): node is TSceneNode => node !== undefined)
    .sort((left, right) => {
      return compareByDepthAndSnapshotOrder({
        left,
        right,
        nodesById: previousNodes,
        snapshotOrder: previousOrder,
        deepestFirst: true,
      });
    })
    .map<TSerializedSceneCommand>((node) => ({
      type: "remove",
      nodeId: node.id,
      descendants: "remove",
    }));

  const upsertIds = new Set([
    ...args.diff.nodes.added.map((node) => node.id),
    ...args.diff.nodes.updated.map((node) => node.id),
  ]);
  const upserts = [...upsertIds]
    .map((nodeId) => nextNodes.get(nodeId))
    .filter((node): node is TSceneNode => node !== undefined)
    .sort((left, right) => {
      return compareByDepthAndSnapshotOrder({
        left,
        right,
        nodesById: nextNodes,
        snapshotOrder: nextOrder,
        deepestFirst: false,
      });
    })
    .map<TSerializedSceneCommand>((node) => ({
      type: "upsert",
      node,
    }));

  return [...removals, ...upserts];
}
