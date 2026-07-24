import type {
  TCanvasElementProjection,
  TCanvasGroupProjection,
  TCanvasProjectionIndex,
  TCanvasTarget,
} from "../typed";

type TArgsCreateProjectionIndex = {
  elements: readonly TCanvasElementProjection[];
  groups: readonly TCanvasGroupProjection[];
  activeProjectionSignature: string;
  lastAppliedRevision?: number | null;
};

type TArgsResolveProjectionTarget = {
  index: TCanvasProjectionIndex;
  engineNodeId: string;
};

type TArgsElementProjectionNodeIds = {
  index: TCanvasProjectionIndex;
  elementId: string;
};

function sortedEntries<T>(
  entries: Iterable<readonly [string, T]>,
): Array<[string, T]> {
  return [...entries]
    .map(([key, value]) => [key, value] as [string, T])
    .sort(([left], [right]) => left.localeCompare(right));
}

export function fnCreateProjectionIndex(
  args: TArgsCreateProjectionIndex,
): TCanvasProjectionIndex {
  const elementNodeIds = new Map<string, readonly string[]>();
  const groupNodeIds = new Map<string, string>();
  const nodeTargets = new Map<string, TCanvasTarget>();
  const elementResourceIds = new Map<string, readonly string[]>();
  const elementPortalIds = new Map<string, readonly string[]>();
  const elementSignatures = new Map<string, string>();
  const groupSignatures = new Map<string, string>();

  for (const group of args.groups) {
    const nodeId = group.nodes[0]?.id;
    if (!nodeId) {
      continue;
    }
    groupNodeIds.set(group.semanticTarget.id, nodeId);
    groupSignatures.set(group.semanticTarget.id, group.signature);
    for (const node of group.nodes) {
      nodeTargets.set(node.id, group.semanticTarget);
    }
  }

  for (const element of args.elements) {
    const elementId = element.semanticTarget.id;
    elementNodeIds.set(elementId, element.nodes.map((node) => node.id));
    elementResourceIds.set(
      elementId,
      element.resources.map((resource) => resource.descriptor.id),
    );
    elementPortalIds.set(
      elementId,
      element.portals.map((portal) => portal.portalId),
    );
    elementSignatures.set(elementId, element.signature);
    for (const node of element.nodes) {
      nodeTargets.set(node.id, element.semanticTarget);
    }
  }

  return {
    elementNodeIds: Object.fromEntries(sortedEntries(elementNodeIds)),
    groupNodeIds: Object.fromEntries(sortedEntries(groupNodeIds)),
    nodeTargets: Object.fromEntries(sortedEntries(nodeTargets)),
    elementResourceIds: Object.fromEntries(sortedEntries(elementResourceIds)),
    elementPortalIds: Object.fromEntries(sortedEntries(elementPortalIds)),
    elementSignatures: Object.fromEntries(sortedEntries(elementSignatures)),
    groupSignatures: Object.fromEntries(sortedEntries(groupSignatures)),
    activeProjectionSignature: args.activeProjectionSignature,
    lastAppliedRevision: args.lastAppliedRevision ?? null,
  };
}

export function fnResolveProjectionTarget(
  args: TArgsResolveProjectionTarget,
): TCanvasTarget | null {
  return args.index.nodeTargets[args.engineNodeId] ?? null;
}

export function fnGetElementProjectionNodeIds(
  args: TArgsElementProjectionNodeIds,
): readonly string[] {
  return args.index.elementNodeIds[args.elementId] ?? [];
}
