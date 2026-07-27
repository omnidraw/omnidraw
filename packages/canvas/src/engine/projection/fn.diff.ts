import type { TSceneNode } from "@omnidraw/cangine";
import type {
  TCanvasDocumentProjection,
  TCanvasProjectedPortal,
  TCanvasProjectedResource,
  TCanvasProjectionCollectionDiff,
  TCanvasProjectionDiff,
} from "../typed";
import { fnCanvasProjectionSignature } from "./fn.signature";

type TArgsProjectionDiff = {
  previous: TCanvasDocumentProjection;
  next: TCanvasDocumentProjection;
};

function collectionDiff<T>(args: {
  previous: readonly T[];
  next: readonly T[];
  id: (value: T) => string;
}): TCanvasProjectionCollectionDiff<T> {
  const previousById = new Map(args.previous.map((value) => [args.id(value), value]));
  const nextById = new Map(args.next.map((value) => [args.id(value), value]));
  const added = args.next.filter((value) => !previousById.has(args.id(value)));
  const updated = args.next.filter((value) => {
    const previous = previousById.get(args.id(value));
    return previous !== undefined
      && fnCanvasProjectionSignature({ value: previous })
        !== fnCanvasProjectionSignature({ value });
  });
  const removed = [...args.previous]
    .reverse()
    .filter((value) => !nextById.has(args.id(value)))
    .map(args.id);
  return { added, updated, removed };
}

function entityDiff(
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): {
  added: string[];
  updated: string[];
  removed: string[];
} {
  const previousIds = Object.keys(previous);
  const nextIds = Object.keys(next);
  return {
    added: nextIds.filter((id) => previous[id] === undefined).sort(),
    updated: nextIds.filter((id) => {
      return previous[id] !== undefined && previous[id] !== next[id];
    }).sort(),
    removed: previousIds.filter((id) => next[id] === undefined).sort(),
  };
}

function hasCollectionChanges<T>(diff: TCanvasProjectionCollectionDiff<T>): boolean {
  return diff.added.length > 0 || diff.updated.length > 0 || diff.removed.length > 0;
}

export function fnDiffCanvasProjections(
  args: TArgsProjectionDiff,
): TCanvasProjectionDiff {
  const nodes = collectionDiff<TSceneNode>({
    previous: args.previous.snapshot.nodes,
    next: args.next.snapshot.nodes,
    id: (node) => node.id,
  });
  const resources = collectionDiff<TCanvasProjectedResource>({
    previous: args.previous.resources,
    next: args.next.resources,
    id: (resource) => resource.descriptor.id,
  });
  const portals = collectionDiff<TCanvasProjectedPortal>({
    previous: args.previous.portals,
    next: args.next.portals,
    id: (portal) => portal.portalId,
  });
  const elements = entityDiff(
    args.previous.index.elementSignatures,
    args.next.index.elementSignatures,
  );
  const groups = entityDiff(
    args.previous.index.groupSignatures,
    args.next.index.groupSignatures,
  );
  const changed = hasCollectionChanges(nodes)
    || hasCollectionChanges(resources)
    || hasCollectionChanges(portals)
    || elements.added.length > 0
    || elements.updated.length > 0
    || elements.removed.length > 0
    || groups.added.length > 0
    || groups.updated.length > 0
    || groups.removed.length > 0;

  return {
    nodes,
    resources,
    portals,
    elements,
    groups,
    changed,
    previousSignature: args.previous.signature,
    nextSignature: args.next.signature,
  };
}
